import "server-only";

import { z } from "zod";

/**
 * The two Tavily endpoints research uses. Every call is a separate, bounded
 * request: a failure throws and the caller records that one signal as
 * unavailable, so one slow endpoint never sinks the others.
 */

export interface TavilyOptions {
  apiKey: string;
  fetcher?: typeof fetch;
}

const searchResponse = z.object({
  answer: z.string().nullable().optional(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    content: z.string(),
    published_date: z.string().nullable().optional(),
  })),
});

const extractResponse = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string().nullable().optional() })),
  failed_results: z.array(z.unknown()).optional(),
});

export type SearchResponse = z.infer<typeof searchResponse>;
export type ExtractResponse = z.infer<typeof extractResponse>;

export interface SearchRequest {
  query: string;
  search_depth: "basic";
  max_results: number;
  topic?: "general" | "news";
  time_range?: "year";
  include_answer?: "basic" | false;
  include_domains?: string[];
}

export class TavilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TavilyError";
  }
}

async function post<T>(
  path: "search" | "extract",
  body: object,
  schema: z.ZodType<T>,
  options: TavilyOptions,
  timeoutMs: number,
): Promise<T> {
  const response = await (options.fetcher ?? fetch)(`https://api.tavily.com/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  // The status only; provider error bodies can echo request details.
  if (!response.ok) throw new TavilyError(`Tavily ${path} returned ${response.status}`);
  return schema.parse(await response.json());
}

/** 1 credit. */
export const tavilySearch = (request: SearchRequest, options: TavilyOptions) =>
  post("search", { include_raw_content: false, ...request }, searchResponse, options, 10_000);

/** 0.2 credits per successfully extracted URL. */
export const tavilyExtract = (url: string, options: TavilyOptions) =>
  post("extract", { urls: [url], extract_depth: "basic", format: "text" }, extractResponse, options, 15_000);
