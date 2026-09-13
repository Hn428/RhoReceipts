import "server-only";

import {
  ADVERSE_NEWS,
  PARKED_DOMAIN,
  coreName,
  excerptAround,
  nameAppears,
} from "./match";
import { judgeEvidence, quoteAppears, type JudgeDecision } from "./judge";
import { tavilyExtract, tavilySearch, type TavilyOptions } from "./tavily";

export interface ResearchSubject {
  name: string;
  domain: string | null;
  relatedParty: boolean;
  isDemo: boolean;
  /** The founder's own email domain. A customer billing from it is flagged. */
  founderDomain?: string | null;
  /** Ledger facts that shape simulated research for fictional customers only. */
  invoiced?: boolean;
  overdueInvoice?: boolean;
}

export interface ResearchSource {
  title: string;
  url: string;
  excerpt: string;
  /** Optional so receipts issued before source classification still render. */
  kind?: "billing_domain" | "supporting" | "website" | "registry" | "news";
  sourceDomain?: string;
  publishedDate?: string;
}

/**
 * found: the check positively established something. not_found: it completed
 * and didn't. attention: it found something an investor should look at.
 * unavailable: the provider failed. skipped: the check didn't apply.
 */
export type SignalOutcome = "found" | "not_found" | "attention" | "unavailable" | "skipped";

export interface ResearchSignal {
  outcome: SignalOutcome;
  /** One plain sentence, shown on the receipt. */
  detail: string;
  sources: ResearchSource[];
  /** The model's explanation, when a model judged this check. */
  reasoning?: string;
}

export interface ResearchSignals {
  /** The billing domain's homepage names the company. */
  website: ResearchSignal;
  /** A search result hosted on the billing domain names the company. */
  webPresence: ResearchSignal;
  /** A listing on a company-registry site names the company. */
  registry: ResearchSignal;
  /** Last twelve months of news, with adverse terms called out. */
  news: ResearchSignal;
}

export type ResearchFlag = "related_party" | "founder_domain" | "parked_domain" | "no_footprint" | "adverse_news";

export interface CustomerResearch {
  /** The name researched. Absent on receipts issued before multi-signal research. */
  name?: string;
  status: "Verified" | "Needs review" | "Flagged";
  provider: "simulated" | "tavily" | "unavailable";
  checkedAt: string;
  domain: string | null;
  reason: string;
  registration: string;
  /** True only when both the customer name and billing domain match one result. */
  officialDomainMatch?: boolean;
  evidence: ResearchSource[];
  /** Absent on receipts issued before multi-signal research. */
  signals?: ResearchSignals;
  flags?: ResearchFlag[];
  /**
   * Tavily's generated one-line description of the company. Text about the
   * customer only; it never feeds a figure or a verdict.
   */
  profile?: { summary: string };
  /**
   * Who read the evidence. Rules are deterministic string matching; a fallback
   * means the model was configured but failed, so the result isn't cached.
   */
  judge?: { provider: "openai"; model: string } | { provider: "rules"; fallback?: boolean };
}

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

/** Registry sites searched for a listing. A hit is a web result, not a registry query. */
export const REGISTRY_DOMAINS = ["opencorporates.com", "sec.gov", "find-and-update.company-information.service.gov.uk"];

const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

const signal = (outcome: SignalOutcome, detail: string, sources: ResearchSource[] = []): ResearchSignal =>
  ({ outcome, detail, sources });

const toSources = (
  results: { title: string; url: string; content: string; published_date?: string | null }[],
  kind: (host: string) => ResearchSource["kind"],
): ResearchSource[] => results.flatMap((result) => {
  const url = safeEvidenceUrl(result.url);
  if (!url) return [];
  const sourceDomain = hostOf(url);
  // Stored as ISO only when parseable; a malformed date would break rendering later.
  const published = result.published_date ? Date.parse(result.published_date) : Number.NaN;
  return [{
    title: result.title.slice(0, 300),
    url,
    excerpt: result.content.slice(0, 800),
    kind: kind(sourceDomain),
    sourceDomain,
    ...(Number.isNaN(published) ? {} : { publishedDate: new Date(published).toISOString() }),
  }];
});

// ----------------------------------------------------------------- gather
// Tavily collects evidence. Deciding what it shows is a separate step, below.

async function gatherPresence(name: string, domain: string, tavily: TavilyOptions) {
  const response = await tavilySearch({
    query: `${name.slice(0, 200)} ${domain}`,
    search_depth: "basic",
    max_results: 5,
    include_answer: "basic",
  }, tavily);
  const sources = toSources(response.results, (host) => onDomain(host, domain) ? "billing_domain" : "supporting")
    .sort((a, b) => Number(b.kind === "billing_domain") - Number(a.kind === "billing_domain"));
  return { sources, summary: response.answer?.trim().slice(0, 320) || undefined };
}

/** Null when the homepage couldn't be reached. */
async function gatherHomepage(domain: string, tavily: TavilyOptions) {
  const url = `https://${domain}`;
  const response = await tavilyExtract(url, tavily);
  const text = response.results[0]?.raw_content ?? "";
  return text.trim() ? { url, text } : null;
}

async function gatherRegistry(name: string, tavily: TavilyOptions) {
  const response = await tavilySearch({
    query: coreName(name).slice(0, 200),
    search_depth: "basic",
    max_results: 5,
    include_domains: REGISTRY_DOMAINS,
  }, tavily);
  return toSources(response.results, () => "registry")
    .filter((s) => REGISTRY_DOMAINS.some((d) => onDomain(s.sourceDomain!, d)));
}

async function gatherNews(name: string, tavily: TavilyOptions) {
  const response = await tavilySearch({
    query: `"${coreName(name).slice(0, 200)}"`,
    search_depth: "basic",
    max_results: 5,
    topic: "news",
    time_range: "year",
  }, tavily);
  return toSources(response.results, () => "news");
}

const FAILED = Symbol("failed");
type Gathered<T> = T | typeof FAILED;

/** Runs one Tavily call, turning any provider failure into a marker. */
async function attempt<T>(gather: () => Promise<T>): Promise<Gathered<T>> {
  try { return await gather(); } catch { return FAILED; }
}

interface Gathering {
  name: string;
  domain: string | null;
  /** Undefined when there's no company domain to check. */
  presence: Gathered<{ sources: ResearchSource[]; summary?: string }> | undefined;
  /** Undefined without a company domain; null when the homepage couldn't be reached. */
  homepage: Gathered<{ url: string; text: string } | null> | undefined;
  registry: Gathered<ResearchSource[]>;
  news: Gathered<ResearchSource[]>;
}

const NO_DOMAIN = "No company billing domain to check.";
const UNAVAILABLE = "This check could not be completed.";

// ------------------------------------------------------------ rules judge

const newsSentence = (count: number, adverse: boolean) => adverse
  ? `${count === 1 ? "A news result" : `${count} news results`} from the last 12 months ${count === 1 ? "describes" : "describe"} adverse events such as layoffs, lawsuits or insolvency.`
  : `${count === 1 ? "One news result" : `${count} news results`} from the last 12 months, none adverse.`;

/** Deterministic string rules: the fallback when no model is configured or it fails. */
function judgeByRules(g: Gathering): ResearchSignals {
  const { name, domain } = g;
  const website = (): ResearchSignal => {
    if (g.homepage === undefined) return signal("skipped", NO_DOMAIN);
    if (g.homepage === FAILED) return signal("unavailable", UNAVAILABLE);
    if (!g.homepage) return signal("not_found", `The homepage at ${domain} couldn't be reached.`);
    const { url, text } = g.homepage;
    if (PARKED_DOMAIN.test(text)) {
      return signal("attention", `The homepage at ${domain} looks like a parked or for-sale domain.`, [
        { title: `${domain} homepage`, url, excerpt: excerptAround(text, "domain"), kind: "website", sourceDomain: domain! },
      ]);
    }
    return nameAppears(text, name)
      ? signal("found", `The homepage at ${domain} names the company.`, [
        { title: `${domain} homepage`, url, excerpt: excerptAround(text, name), kind: "website", sourceDomain: domain! },
      ])
      : signal("not_found", `The homepage at ${domain} loads but doesn't name the company.`);
  };
  const presence = (): ResearchSignal => {
    if (g.presence === undefined) return signal("skipped", NO_DOMAIN);
    if (g.presence === FAILED) return signal("unavailable", UNAVAILABLE);
    const { sources } = g.presence;
    return sources.some((s) => s.kind === "billing_domain" && nameAppears(`${s.title} ${s.excerpt}`, name))
      ? signal("found", `A search result on ${domain} names the company.`, sources)
      : signal("not_found", sources.length ? `Search results didn't show the company name on ${domain}.` : "The search returned no results.", sources);
  };
  const registry = (): ResearchSignal => {
    if (g.registry === FAILED) return signal("unavailable", UNAVAILABLE);
    const listings = g.registry.filter((s) => nameAppears(s.title, name));
    return listings.length
      ? signal("found", `A listing naming the company was found on ${listings[0].sourceDomain}.`, listings)
      : signal("not_found", "No listing was found on the registry sites searched. Many private companies aren't indexed there.");
  };
  const news = (): ResearchSignal => {
    if (g.news === FAILED) return signal("unavailable", UNAVAILABLE);
    const relevant = g.news.filter((s) => nameAppears(`${s.title} ${s.excerpt}`, name));
    const adverse = relevant.filter((s) => ADVERSE_NEWS.test(`${s.title} ${s.excerpt}`));
    if (adverse.length) return signal("attention", newsSentence(adverse.length, true), [...adverse, ...relevant.filter((s) => !adverse.includes(s))]);
    return relevant.length
      ? signal("found", newsSentence(relevant.length, false), relevant)
      : signal("not_found", "No news coverage naming the company in the last 12 months.");
  };
  return { website: website(), webPresence: presence(), registry: registry(), news: news() };
}

// ----------------------------------------------------------- model judge

const notCounted = "The model's cited quote isn't in the source, so this wasn't counted.";

/**
 * Turns a model's answers into signals. Every positive answer must cite a
 * source by number and, where asked, quote it; code checks both before
 * counting it, so an invented quote or an off-domain source can't verify anyone.
 */
function signalsFromDecision(g: Gathering, d: JudgeDecision): ResearchSignals {
  const { domain } = g;
  const website = (): ResearchSignal => {
    if (g.homepage === undefined) return signal("skipped", NO_DOMAIN);
    if (g.homepage === FAILED) return signal("unavailable", UNAVAILABLE);
    if (!g.homepage) return signal("not_found", `The homepage at ${domain} couldn't be reached.`);
    const page = g.homepage;
    const source = (excerpt: string): ResearchSource[] =>
      [{ title: `${domain} homepage`, url: page.url, excerpt, kind: "website", sourceDomain: domain! }];
    const { verdict, quote, reasoning } = d.website;
    if (verdict === "parked") {
      return { ...signal("attention", `The homepage at ${domain} looks like a parked or for-sale domain.`, source(excerptAround(page.text, "domain"))), reasoning };
    }
    if (verdict === "names_company") {
      return quoteAppears(quote, page.text)
        ? { ...signal("found", `The homepage at ${domain} identifies the company.`, source(quote!)), reasoning }
        : { ...signal("not_found", `The homepage at ${domain} wasn't shown to identify the company.`), reasoning: `${reasoning} ${notCounted}` };
    }
    return { ...signal("not_found", `The homepage at ${domain} doesn't identify the company.`), reasoning };
  };
  const presence = (): ResearchSignal => {
    if (g.presence === undefined) return signal("skipped", NO_DOMAIN);
    if (g.presence === FAILED) return signal("unavailable", UNAVAILABLE);
    const { sources } = g.presence;
    const { verdict, source, quote, reasoning } = d.webPresence;
    const cited = source !== null ? sources[source - 1] : undefined;
    if (verdict === "confirms") {
      if (cited?.kind === "billing_domain" && quoteAppears(quote, `${cited.title} ${cited.excerpt}`)) {
        return { ...signal("found", `A search result on ${domain} identifies the company.`, [cited, ...sources.filter((s) => s !== cited)]), reasoning };
      }
      return { ...signal("not_found", `No search result on ${domain} was shown to identify the company.`, sources), reasoning: `${reasoning} ${cited?.kind === "billing_domain" ? notCounted : "The cited result isn't on the billing domain, so this wasn't counted."}` };
    }
    return { ...signal("not_found", sources.length ? `No search result on ${domain} identifies the company.` : "The search returned no results.", sources), reasoning };
  };
  const registry = (): ResearchSignal => {
    if (g.registry === FAILED) return signal("unavailable", UNAVAILABLE);
    const { verdict, source, reasoning } = d.registry;
    const cited = source !== null ? g.registry[source - 1] : undefined;
    if (verdict === "same_entity" && cited) {
      return { ...signal("found", `A listing for the same entity was found on ${cited.sourceDomain}.`, [cited]), reasoning };
    }
    const detail = !g.registry.length
      ? "No listing was found on the registry sites searched. Many private companies aren't indexed there."
      : verdict === "different_entity"
        ? "Registry listings found are for a different entity with a similar name."
        : "Registry listings found couldn't be matched to this customer.";
    return { ...signal("not_found", detail, g.registry), reasoning };
  };
  const news = (): ResearchSignal => {
    if (g.news === FAILED) return signal("unavailable", UNAVAILABLE);
    const articles = g.news;
    const judged = d.news.items
      .filter((item, i, all) => articles[item.source - 1] && all.findIndex((x) => x.source === item.source) === i)
      .filter((item) => item.about_customer);
    const adverse = judged.filter((item) => item.adverse);
    const order = [...adverse, ...judged.filter((item) => !item.adverse)];
    const sources = order.map((item) => articles[item.source - 1]);
    const reasoning = order.map((item) => `[${articles[item.source - 1].title.slice(0, 80)}] ${item.reasoning}`).join(" ") || undefined;
    if (adverse.length) return { ...signal("attention", newsSentence(adverse.length, true), sources), reasoning };
    return judged.length
      ? { ...signal("found", newsSentence(judged.length, false), sources), reasoning }
      : { ...signal("not_found", "No news coverage about this company in the last 12 months."), reasoning };
  };
  return { website: website(), webPresence: presence(), registry: registry(), news: news() };
}

// ------------------------------------------------------------------ verdict

export const RESEARCH_FLAG_REASONS: Record<ResearchFlag, string> = {
  related_party: "Bank records show this customer both pays and is paid by the company.",
  founder_domain: "The customer's billing domain is the founder's own email domain.",
  parked_domain: "The billing domain's homepage looks parked or for sale.",
  no_footprint: "No website, matching search result or registry listing was found. This is a review flag, not proof the customer doesn't exist.",
  adverse_news: "Recent news about this customer mentions adverse terms.",
};

/**
 * The only place a research status is decided. Identity flags make a customer
 * Flagged; a website or billing-domain match makes it Verified. Adverse news is
 * reported alongside but doesn't change whether the customer is who it claims.
 */
export function deriveVerdict(
  signals: ResearchSignals,
  facts: { relatedParty: boolean; sharesFounderDomain: boolean; hasCompanyDomain: boolean },
): Pick<CustomerResearch, "status" | "flags" | "reason" | "registration" | "officialDomainMatch"> {
  const flags: ResearchFlag[] = [];
  if (facts.relatedParty) flags.push("related_party");
  if (facts.sharesFounderDomain) flags.push("founder_domain");
  if (signals.website.outcome === "attention") flags.push("parked_domain");
  // Nothing at all: the site doesn't name them, the search came back empty, and
  // no registry lists them. A same-name result on another domain isn't "nothing".
  if (
    facts.hasCompanyDomain &&
    [signals.website, signals.webPresence, signals.registry].every((s) => s.outcome === "not_found") &&
    signals.webPresence.sources.length === 0
  ) {
    flags.push("no_footprint");
  }
  if (signals.news.outcome === "attention") flags.push("adverse_news");

  const identityFlags = flags.filter((flag) => flag !== "adverse_news");
  const verified = signals.website.outcome === "found" || signals.webPresence.outcome === "found";
  const status = identityFlags.length ? "Flagged" : verified ? "Verified" : "Needs review";
  const checks = Object.values(signals);
  const incomplete = checks.every((s) => s.outcome === "unavailable" || s.outcome === "skipped");

  const reason = identityFlags.length
    ? identityFlags.map((flag) => RESEARCH_FLAG_REASONS[flag]).join(" ")
    : verified
      ? `${signals.website.outcome === "found" ? "The customer's website names the company" : "A search result on the billing domain names the company"}${signals.registry.outcome === "found" ? ", and a registry listing was found" : ""}. This confirms web presence, not legal identity or payment legitimacy.`
      : incomplete
        ? facts.hasCompanyDomain
          ? "External research could not be completed. Issue a new receipt to retry; this is not evidence of an absent business."
          : "No company-specific billing domain is available for a reliable identity match."
        : facts.hasCompanyDomain
          ? "Web checks did not establish that the billing domain belongs to a company with this name."
          : "No company-specific billing domain is available, so identity can't be matched to a website.";

  const registration = signals.registry.outcome === "found"
    ? `${signals.registry.detail} Found by web search of registry sites, not by querying a registry directly.`
    : signals.registry.outcome === "not_found"
      ? signals.registry.detail
      : "Registration has not been independently confirmed.";

  return { status, flags, reason, registration, officialDomainMatch: signals.webPresence.outcome === "found" };
}

// -------------------------------------------------------------- simulation

/**
 * Fictional customers can't be searched: a live result would describe an
 * unrelated real business. Simulated signals follow the ledger instead, so the
 * story is consistent: invoiced customers have a footprint, customers paid
 * without an invoice don't, and an overdue invoice comes with worrying news.
 */
function simulatedSignals(subject: ResearchSubject, domain: string | null): ResearchSignals {
  const invoiced = subject.invoiced ?? true;
  const present = Boolean(domain) && invoiced;
  return {
    website: present
      ? signal("found", `Simulated: the homepage at ${domain} names the company.`)
      : signal(domain ? "not_found" : "skipped", domain ? "Simulated: no website could be matched to this customer." : "No company billing domain to check."),
    webPresence: present
      ? signal("found", `Simulated: a search result on ${domain} names the company.`)
      : signal(domain ? "not_found" : "skipped", domain ? "Simulated: no search result on the billing domain names the company." : "No company billing domain to match against."),
    registry: invoiced
      ? signal("found", "Simulated: a registry listing naming the company.")
      : signal("not_found", "Simulated: no registry listing was found."),
    news: subject.overdueInvoice
      ? signal("attention", "Simulated: news reports layoffs at this company, which also has an overdue invoice.")
      : signal("not_found", "Simulated: no news coverage in the last 12 months."),
  };
}

// --------------------------------------------------------------------- entry

/** Only names and billing domains leave the server; never payments or email addresses. */
export async function researchCustomer(
  subject: ResearchSubject,
  options: {
    apiKey?: string;
    /** Judges the gathered evidence. Without it, string rules decide. */
    openai?: { apiKey: string; model: string };
    fetcher?: typeof fetch;
    now?: Date;
  } = {},
): Promise<CustomerResearch> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const domain = normalizeDomain(subject.domain);
  const companyDomain = domain && !personalDomains.has(domain) ? domain : null;
  const founderDomain = normalizeDomain(subject.founderDomain ?? null);
  const facts = {
    relatedParty: subject.relatedParty,
    sharesFounderDomain: Boolean(companyDomain && founderDomain === companyDomain),
    hasCompanyDomain: Boolean(companyDomain),
  };

  if (subject.isDemo) {
    const signals = simulatedSignals(subject, companyDomain);
    const verdict = deriveVerdict(signals, facts);
    return {
      ...verdict,
      name: subject.name,
      provider: "simulated",
      checkedAt,
      domain,
      evidence: [],
      signals,
      registration: signals.registry.outcome === "found"
        ? "Simulated registry listing; no real registry was searched."
        : "Simulated: no registry listing; no real registry was searched.",
    };
  }

  const noDomain = "No company billing domain to check.";
  if (!options.apiKey) {
    const off = signal("unavailable", "External research is not configured.");
    const signals: ResearchSignals = {
      website: companyDomain ? off : signal("skipped", noDomain),
      webPresence: companyDomain ? off : signal("skipped", noDomain),
      registry: off,
      news: off,
    };
    return { ...deriveVerdict(signals, facts), name: subject.name, provider: "unavailable", checkedAt, domain, evidence: [], signals };
  }

  const tavily: TavilyOptions = { apiKey: options.apiKey, fetcher: options.fetcher };
  const [presence, homepage, registry, news] = await Promise.all([
    companyDomain ? attempt(() => gatherPresence(subject.name, companyDomain, tavily)) : Promise.resolve(undefined),
    companyDomain ? attempt(() => gatherHomepage(companyDomain, tavily)) : Promise.resolve(undefined),
    attempt(() => gatherRegistry(subject.name, tavily)),
    attempt(() => gatherNews(subject.name, tavily)),
  ]);
  const gathering: Gathering = { name: subject.name, domain: companyDomain, presence, homepage, registry, news };

  let signals: ResearchSignals;
  let judge: CustomerResearch["judge"];
  if (options.openai) {
    try {
      const usable = <T,>(value: Gathered<T> | undefined) => (value === FAILED || value === undefined ? null : value);
      const decision = await judgeEvidence({
        name: subject.name,
        domain: companyDomain,
        homepage: usable(homepage),
        presence: usable(presence)?.sources ?? null,
        registry: usable(registry),
        news: usable(news),
      }, { apiKey: options.openai.apiKey, model: options.openai.model, fetcher: options.fetcher });
      signals = signalsFromDecision(gathering, decision);
      judge = { provider: "openai", model: options.openai.model };
    } catch {
      signals = judgeByRules(gathering);
      judge = { provider: "rules", fallback: true };
    }
  } else {
    signals = judgeByRules(gathering);
    judge = { provider: "rules" };
  }

  const outcomes = Object.values(signals).map((s) => s.outcome);
  const provider = outcomes.some((o) => o !== "unavailable" && o !== "skipped") ? "tavily" : "unavailable";
  const summary = presence !== undefined && presence !== FAILED ? presence.summary : undefined;
  return {
    ...deriveVerdict(signals, facts),
    name: subject.name,
    provider,
    checkedAt,
    domain,
    evidence: signals.webPresence.sources,
    signals,
    judge,
    ...(summary ? { profile: { summary } } : {}),
  };
}

/** A result with any failed check is retried at the next issuance rather than cached. */
export const isComplete = (research: CustomerResearch) =>
  research.provider !== "unavailable" &&
  !(research.judge?.provider === "rules" && research.judge.fallback) &&
  !Object.values(research.signals ?? {}).some((s) => s.outcome === "unavailable");
