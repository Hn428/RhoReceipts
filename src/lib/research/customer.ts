import "server-only";

import { z } from "zod";

export interface ResearchSubject {
  name: string;
  domain: string | null;
  relatedParty: boolean;
  isDemo: boolean;
}

export interface CustomerResearch {
  status: "Verified" | "Needs review" | "Flagged";
  provider: "simulated" | "tavily" | "unavailable";
  checkedAt: string;
  domain: string | null;
  reason: string;
  registration: string;
  /** True only when both the customer name and billing domain match one result. */
  officialDomainMatch?: boolean;
  evidence: {
    title: string;
    url: string;
    excerpt: string;
    /** Optional so receipts issued before source classification still render. */
    kind?: "billing_domain" | "supporting";
    sourceDomain?: string;
  }[];
}

const responseSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string() })),
});

export function safeEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

export function normalizeDomain(value: string | null): string | null {
  const domain = value?.trim().toLowerCase().replace(/^www\./, "");
  return domain && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)
    ? domain : null;
}

const personalDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"]);
const normalizedName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Only names and billing domains leave the server; never payments or email addresses. */
export async function researchCustomer(
  subject: ResearchSubject,
  options: { apiKey?: string; fetcher?: typeof fetch; now?: Date } = {},
): Promise<CustomerResearch> {
  const domain = normalizeDomain(subject.domain);
  const base: CustomerResearch = {
    status: "Needs review", provider: "unavailable", checkedAt: (options.now ?? new Date()).toISOString(),
    domain, reason: "External research is not configured.",
    registration: "Registration has not been independently confirmed.", evidence: [],
  };
  if (subject.isDemo) return {
    ...base, provider: "simulated", status: subject.relatedParty ? "Flagged" : domain ? "Verified" : "Needs review",
    reason: subject.relatedParty
      ? "Simulated research. Bank records show this customer both pays and is paid by the company."
      : domain ? "Simulated matching web presence. This fictional customer has not been searched on the live web."
        : "Simulated research: no customer domain is available to match.",
    registration: "Simulated registration footprint; no real registry check was performed.",
  };
  if (subject.relatedParty) return {
    ...base, status: "Flagged", reason: "Bank records show this customer both pays and is paid by the company. External identity remains unconfirmed.",
  };
  if (!domain || personalDomains.has(domain)) return {
    ...base, reason: "No company-specific billing domain is available for a reliable identity match.",
  };
  if (!options.apiKey) return base;
  try {
    const response = await (options.fetcher ?? fetch)("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ query: `${subject.name.slice(0, 200)} ${domain}`, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false }),
      signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    if (!response.ok) throw new Error("Research unavailable");
    const parsed = responseSchema.parse(await response.json());
    const evidence = parsed.results.flatMap((result) => {
      const url = safeEvidenceUrl(result.url);
      if (!url) return [];
      const sourceDomain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      const kind = sourceDomain === domain || sourceDomain.endsWith(`.${domain}`)
        ? "billing_domain" as const : "supporting" as const;
      return [{
        title: result.title.slice(0, 300), url, excerpt: result.content.slice(0, 800),
        kind, sourceDomain,
      }];
    });
    const name = normalizedName(subject.name).replace(/\s+(inc|llc|ltd|corp|corporation)$/, "");
    const matched = name.length >= 3 && evidence.some((result) => {
      return result.kind === "billing_domain" &&
        (` ${normalizedName(`${result.title} ${result.excerpt}`)} `).includes(` ${name} `);
    });
    evidence.sort((a, b) => Number(b.kind === "billing_domain") - Number(a.kind === "billing_domain"));
    return { ...base, provider: "tavily", evidence, officialDomainMatch: matched,
      status: matched ? "Verified" : parsed.results.length === 0 ? "Flagged" : "Needs review",
      reason: matched ? "A search result on the billing domain matches the customer name. This verifies web presence only, not legal identity or payment legitimacy."
        : parsed.results.length === 0 ? "The search returned no public footprint. This is a review flag, not proof the customer does not exist."
          : "Search results did not establish a matching name on the billing domain.",
    };
  } catch {
    return { ...base, reason: "External research could not be completed. Issue a new receipt to retry; this is not evidence of an absent business." };
  }
}
