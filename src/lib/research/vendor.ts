import "server-only";

import { safeEvidenceUrl, type ResearchSource } from "./customer";
import { vendorNameAppears } from "./match";
import { tavilySearch } from "./tavily";

/**
 * A live check that the businesses a company pays exist on the public web.
 *
 * Vendors are real businesses even in the demo ledger (AWS, Gusto, Anthropic),
 * so unlike fictional customers they can be searched live. The claim is narrow
 * on purpose: a business by this name has a public footprint. It doesn't
 * establish that it's the same business that was paid.
 */
export interface VendorResearch {
  provider: "tavily" | "unavailable";
  checkedAt: string;
  outcome: "found" | "not_found" | "unavailable";
  detail: string;
  /** Tavily's generated one-line description. Text only; never a figure or verdict. */
  summary?: string;
  sources: ResearchSource[];
}

export async function researchVendor(
  name: string,
  options: { apiKey?: string; fetcher?: typeof fetch; now?: Date } = {},
): Promise<VendorResearch> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  if (!options.apiKey) {
    return { provider: "unavailable", checkedAt, outcome: "unavailable", detail: "External research is not configured.", sources: [] };
  }
  try {
    const response = await tavilySearch({
      query: name.slice(0, 200),
      search_depth: "basic",
      max_results: 5,
      include_answer: "basic",
    }, { apiKey: options.apiKey, fetcher: options.fetcher });
    const sources = response.results.flatMap((result): ResearchSource[] => {
      const url = safeEvidenceUrl(result.url);
      if (!url || !vendorNameAppears(`${result.title} ${result.content}`, name)) return [];
      return [{
        title: result.title.slice(0, 300),
        url,
        excerpt: result.content.slice(0, 400),
        kind: "supporting",
        sourceDomain: new URL(url).hostname.toLowerCase().replace(/^www\./, ""),
      }];
    }).slice(0, 3);
    const summary = response.answer?.trim().slice(0, 320);
    return sources.length
      ? {
        provider: "tavily", checkedAt, outcome: "found", sources,
        detail: "Public web results name a business by this name. This doesn't confirm it's the same business that was paid.",
        ...(summary ? { summary } : {}),
      }
      : {
        provider: "tavily", checkedAt, outcome: "not_found", sources: [],
        detail: "No public web result names a business by this name. Worth asking what this spend is for.",
      };
  } catch {
    return { provider: "unavailable", checkedAt, outcome: "unavailable", detail: "The web check could not be completed.", sources: [] };
  }
}
