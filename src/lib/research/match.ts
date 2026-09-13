/**
 * Deterministic text matching for research results. A web result counts only
 * when these rules say so. Tavily supplies sources, never verdicts.
 */

const LEGAL_SUFFIX = /\s+(inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|co|company|plc|pbc|gmbh|ag|sa|sas|sarl|spa|srl|ab|bv|nv|pty|pte|kk)$/;

/** "Tessellate Health, Inc." → "tessellate health". */
export function coreName(name: string): string {
  let core = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  // Strip stacked suffixes ("Holdings Group Co") one at a time, keeping at least one word.
  while (LEGAL_SUFFIX.test(core) && core.split(" ").length > 1) core = core.replace(LEGAL_SUFFIX, "");
  return core;
}

const normalizedText = (text: string) =>
  ` ${text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** True when the whole core name appears as words in the text. */
export function nameAppears(text: string, name: string): boolean {
  const core = coreName(name);
  return core.length >= 3 && normalizedText(text).includes(` ${core} `);
}

/**
 * Words that describe what a vendor sells rather than who it is. "Gusto Payroll"
 * appears on the web as "Gusto", so vendors match on their distinctive words.
 */
const DESCRIPTIVE_WORDS = new Set([
  "payroll", "cloud", "gpu", "technologies", "technology", "labs", "software", "services",
  "service", "platform", "inc", "app", "store", "online", "group", "holdings", "the", "and",
]);

/** Vendor names match when every distinctive word appears in the text. */
export function vendorNameAppears(text: string, name: string): boolean {
  const words = coreName(name).split(" ").filter((word) => word.length > 1 && !DESCRIPTIVE_WORDS.has(word));
  if (words.join("").length < 3) return nameAppears(text, name);
  const haystack = normalizedText(text);
  return words.every((word) => haystack.includes(` ${word} `));
}

/** Terms that make a news result worth an investor's attention. */
export const ADVERSE_NEWS = /\b(bankrupt\w*|chapter 11|insolven\w*|receivership|liquidat\w*|lawsuits?|sued|fraud\w*|indict\w*|investigat\w*|layoffs?|laid off|lays off|shut(s|ting)? down|closes? (its )?doors|defaults?|data breach|recalls?|sanction\w*|wind(s|ing)? down)\b/i;

/** Homepages that exist only to sell or park the domain. */
export const PARKED_DOMAIN = /\b(domain (is |may be )?for sale|buy this domain|this domain is parked|parked free|domain parking|make an offer on this domain|hugedomains|sedo domain)\b/i;

/** A short window of text around the first match, for display as evidence. */
export function excerptAround(text: string, name: string, radius = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const core = coreName(name).split(" ")[0] ?? "";
  const at = core ? flat.toLowerCase().indexOf(core) : -1;
  if (at === -1) return flat.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, at + radius)}${at + radius < flat.length ? "…" : ""}`;
}
