import type { ReactNode } from "react";

import type { CustomerRevenue } from "@/lib/metrics";
import type { SnapshotTransaction, VendorLine } from "@/lib/receipts";
import type { ResearchCoverage } from "@/lib/research/coverage";
import type { CustomerResearch, ResearchSignals, SignalOutcome } from "@/lib/research/customer";
import { dayShort, percent, signed, whole, year } from "@/lib/receipts/format";

export function Chevron() {
  return (
    <svg
      className="chevron shrink-0 text-ink-faint"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Tick({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.4 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

const TONES = {
  verified: "border-verified/35 bg-verified-wash text-verified",
  inferred: "border-inferred/35 bg-inferred-wash text-inferred",
  flagged: "border-flagged/35 bg-flagged-wash text-flagged",
  neutral: "border-rule-strong bg-sunken text-ink-soft",
} as const;

export function Chip({
  tone,
  children,
  title,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] border px-1.5 py-px font-mono text-[0.66rem] uppercase tracking-[0.06em] ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function AttributionChip({
  attribution,
}: {
  attribution: CustomerRevenue["attribution"];
}) {
  switch (attribution) {
    case "invoice":
      return (
        <Chip tone="verified" title="Rho links this payment to the customer's invoice">
          <Tick /> Invoiced
        </Chip>
      );
    case "name_match":
      return (
        <Chip tone="inferred" title="Matched by name only — no invoice backs this revenue">
          No invoice
        </Chip>
      );
    case "aggregated":
      return (
        <Chip tone="neutral" title="A payment processor payout covering many customers">
          Aggregated
        </Chip>
      );
    default:
      return null;
  }
}

/** One itemised line on the receipt that unfolds into its evidence. */
export function MetricLine({
  id,
  label,
  figure,
  unit,
  note,
  children,
}: {
  id?: string;
  label: string;
  figure: string;
  /** A quiet suffix such as "/mo". */
  unit?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <details id={id} className="scroll-mt-20 border-b border-rule">
      <summary className="flex items-baseline gap-3 py-4 hover:bg-sunken/60 md:-mx-3 md:px-3">
        <Chevron />
        <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-[0.97rem] text-ink">{label}</span>
          {note && <span className="text-xs text-ink-faint">{note}</span>}
        </span>
        <span
          aria-hidden="true"
          className="min-w-6 flex-1 -translate-y-1 border-b border-dotted border-rule-strong"
        />
        <span className="figures whitespace-nowrap text-lg text-ink">
          {figure}
          {unit && <span className="ml-0.5 text-xs text-ink-faint">{unit}</span>}
        </span>
      </summary>
      <div className="flex flex-col gap-5 pb-7 pt-1 md:pl-[1.4rem]">{children}</div>
    </details>
  );
}

export function Method({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] text-sm leading-relaxed text-ink-soft">{children}</p>;
}

export function SubHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-1.5">
      <h4 className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
        {children}
      </h4>
      {aside && <span className="figures text-sm text-ink">{aside}</span>}
    </div>
  );
}

const byDateDesc = (a: SnapshotTransaction, b: SnapshotTransaction) =>
  Date.parse(b.postedAt ?? b.initiatedAt) - Date.parse(a.postedAt ?? a.initiatedAt);

/** The bank records behind a figure. */
export function TransactionRows({
  ids,
  transactions,
  limit = 40,
  sort = "date",
}: {
  ids: readonly string[];
  transactions: Record<string, SnapshotTransaction>;
  limit?: number;
  sort?: "date" | "size";
}) {
  const rows = [...new Set(ids)]
    .map((id) => transactions[id])
    .filter((row): row is SnapshotTransaction => Boolean(row))
    .sort(
      sort === "size"
        ? (a, b) => Math.abs(b.amount.minor) - Math.abs(a.amount.minor)
        : byDateDesc,
    );
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;

  if (rows.length === 0) {
    return <p className="text-sm text-ink-faint">No transactions.</p>;
  }

  return (
    <div className="overflow-x-auto">
      {/* Fixed layout: long bank memos truncate instead of pushing amounts off-screen. */}
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[4.25rem]" />
          <col />
          <col className="w-[7.5rem]" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th>Date</th>
            <th>Counterparty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className="border-b border-rule/70 align-baseline last:border-b-0">
              <td className="figures whitespace-nowrap py-2 pr-3 text-xs text-ink-faint">
                {/* The year matters: evidence spans many months of history. */}
                <span className="block text-ink-soft">{dayShort(row.postedAt ?? row.initiatedAt)}</span>
                <span className="block text-[0.66rem]">{year(row.postedAt ?? row.initiatedAt)}</span>
              </td>
              <td className="min-w-0 py-2 pr-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-words text-ink">{row.counterparty}</span>
                  {row.invoiceNumber && <Chip tone="verified">{row.invoiceNumber}</Chip>}
                  {row.relatedParty && <Chip tone="flagged">Related party</Chip>}
                  {row.coversMonths > 1 && (
                    <Chip tone="neutral">Spread over {row.coversMonths} months</Chip>
                  )}
                  {row.status !== "settled" && (
                    <Chip tone="neutral">{row.status.replace(/_/g, " ")}</Chip>
                  )}
                </div>
                {row.memo && (
                  <div className="figures mt-0.5 truncate text-[0.7rem] text-ink-faint">
                    {row.memo} · {row.accountName}
                  </div>
                )}
              </td>
              <td className="figures whitespace-nowrap py-2 text-right text-ink">
                {signed(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <p className="pt-2 text-xs text-ink-faint">
          Showing the {shown.length} {sort === "size" ? "largest" : "most recent"} of{" "}
          {rows.length.toLocaleString("en-US")}.
        </p>
      )}
    </div>
  );
}

/** A customer's revenue for the month, unfolding into their payments. */
export function CustomerLine({
  customer,
  transactions,
  aside,
}: {
  customer: CustomerRevenue;
  transactions: Record<string, SnapshotTransaction>;
  aside?: ReactNode;
}) {
  const first = transactions[customer.transactionIds[0]];
  const related = customer.transactionIds.some((id) => transactions[id]?.relatedParty);
  return (
    <details className="border-b border-rule/70 last:border-b-0">
      <summary className="flex items-baseline gap-2.5 py-2.5">
        <Chevron />
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-ink">{customer.customerName}</span>
          <AttributionChip attribution={customer.attribution} />
          {related && <Chip tone="flagged">Related party</Chip>}
        </span>
        <span aria-hidden="true" className="min-w-4 flex-1" />
        {aside}
        <span className="figures whitespace-nowrap text-sm text-ink">{whole(customer.amount)}</span>
      </summary>
      <div className="flex flex-col gap-2 pb-4 pl-5">
        {first && <p className="max-w-[60ch] text-xs leading-relaxed text-ink-soft">{first.reason}</p>}
        <TransactionRows ids={customer.transactionIds} transactions={transactions} />
      </div>
    </details>
  );
}

/** Twelve months of recognised revenue as a small area chart. */
export function Sparkline({
  points,
}: {
  points: { label: string; minor: number }[];
}) {
  if (points.length < 2) return null;
  const width = 320;
  const height = 64;
  const pad = 4;
  const max = Math.max(...points.map((p) => p.minor));
  const min = Math.min(0, ...points.map((p) => p.minor));
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.minor).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const last = points[points.length - 1];

  return (
    <figure className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-16 w-full max-w-[20rem]"
        role="img"
        aria-label={`Recognised revenue from ${points[0].label} to ${last.label}, rising to its latest value.`}
      >
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--rule)" />
        <path d={area} fill="var(--verified-wash)" />
        <path d={line} fill="none" stroke="var(--verified)" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={y(last.minor)} r="3" fill="var(--verified)" />
      </svg>
      <figcaption className="figures flex max-w-[20rem] justify-between text-[0.68rem] text-ink-faint">
        <span>{points[0].label}</span>
        <span>{last.label}</span>
      </figcaption>
    </figure>
  );
}

/** The research verdict as a chip. Related parties are flagged from the ledger even without research. */
export function ResearchChip({ research, related = false }: { research?: CustomerResearch; related?: boolean }) {
  if (!research && !related) return null;
  const status = related ? "Flagged" : research!.status;
  const simulated = research?.provider === "simulated";
  // Tavily receipts issued before multi-signal research called a billing-domain match a web match.
  const label = status === "Verified"
    ? simulated ? "Simulated match" : research?.signals ? "Verified" : "Web match"
    : status;
  return (
    <Chip tone={status === "Flagged" ? "flagged" : status === "Verified" ? "verified" : "inferred"}>
      {label}
    </Chip>
  );
}

/**
 * A paying customer: this month's revenue and verification, opening to their
 * payment history across the last twelve months.
 */
export function PayingCustomerRow({
  customer,
  historyIds,
  transactions,
  research,
}: {
  customer: CustomerRevenue;
  historyIds: readonly string[];
  transactions: Record<string, SnapshotTransaction>;
  research?: CustomerResearch;
}) {
  const first = transactions[customer.transactionIds[0]];
  const related = historyIds.some((id) => transactions[id]?.relatedParty);
  return (
    <details className="border-b border-rule/70 last:border-b-0">
      <summary className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2.5 gap-y-1 py-3 sm:grid-cols-[auto_1fr_7.5rem_11rem] sm:gap-x-3">
        <Chevron />
        <span className="min-w-0 text-sm text-ink">{customer.customerName}</span>
        <span className="figures whitespace-nowrap text-right text-sm text-ink">{whole(customer.amount)}</span>
        <span className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-auto">
          {research || related ? <ResearchChip research={research} related={related} /> : <Chip tone="neutral">Not researched</Chip>}
          {research?.flags?.includes("adverse_news") && <Chip tone="flagged">News</Chip>}
        </span>
      </summary>
      <div className="flex flex-col gap-2 pb-4 pl-5">
        {research?.signals
          ? <ResearchPanel research={research} signals={research.signals} />
          : <LegacyResearchPanel customer={customer} research={research} />}
        <span><AttributionChip attribution={customer.attribution} />{related && <Chip tone="flagged">Related party</Chip>}</span>
        {first && <p className="max-w-[60ch] text-xs leading-relaxed text-ink-soft">{first.reason}</p>}
        <TransactionRows ids={historyIds} transactions={transactions} limit={12} />
      </div>
    </details>
  );
}

const SIGNAL_LABELS: Record<keyof ResearchSignals, { title: string; outcomes: Partial<Record<SignalOutcome, string>> }> = {
  website: { title: "Website", outcomes: { found: "Names the company", not_found: "No match", attention: "Parked domain" } },
  webPresence: { title: "Search results", outcomes: { found: "Name on domain", not_found: "No match" } },
  registry: { title: "Registry sites", outcomes: { found: "Listing found", not_found: "No listing" } },
  news: { title: "News, 12 months", outcomes: { found: "Nothing adverse", not_found: "No coverage", attention: "Adverse terms" } },
};

/** No news is neutral, not a warning; for identity checks, not finding a match is. */
const outcomeDot = (key: keyof ResearchSignals, outcome: SignalOutcome) =>
  key === "news" && outcome === "not_found" ? "bg-rule-strong" : OUTCOME_DOT[outcome];

const OUTCOME_DOT: Record<SignalOutcome, string> = {
  found: "bg-verified",
  attention: "bg-flagged",
  not_found: "bg-inferred",
  unavailable: "bg-rule-strong",
  skipped: "bg-rule-strong",
};

/** Multi-signal research: four checks, each with its own sources. */
function ResearchPanel({ research, signals }: { research: CustomerResearch; signals: ResearchSignals }) {
  const simulated = research.provider === "simulated";
  const keys = Object.keys(SIGNAL_LABELS) as (keyof ResearchSignals)[];
  return (
    <div className="rounded-[2px] border border-rule bg-sunken/40 p-3 text-xs leading-relaxed text-ink-soft">
      <p className="font-medium text-ink">External customer research{simulated ? " · simulated" : ""}</p>
      <p>{research.reason}</p>
      {research.profile && (
        <p className="mt-2 border-l-2 border-rule-strong pl-2.5">
          <span className="text-ink">{research.profile.summary}</span>{" "}
          <span className="text-ink-faint">Summary generated by Tavily from web sources; not verified.</span>
        </p>
      )}
      <dl className="my-3 grid gap-px overflow-hidden rounded-[2px] border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((key) => {
          const item = signals[key];
          const outcome = item.outcome === "unavailable" ? "Unavailable" : item.outcome === "skipped" ? "Not checked"
            : SIGNAL_LABELS[key].outcomes[item.outcome] ?? item.outcome;
          return (
            <div key={key} className="bg-paper p-2.5">
              <dt className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink-faint">{SIGNAL_LABELS[key].title}</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${outcomeDot(key, item.outcome)}`} />
                {outcome}
              </dd>
              <dd className="mt-0.5 text-ink-faint">{item.detail}</dd>
              {item.reasoning && <dd className="mt-1.5 border-t border-rule pt-1.5 text-ink-soft">{item.reasoning}</dd>}
            </div>
          );
        })}
      </dl>
      <p>{research.registration}</p>
      <p>
        Checked {dayShort(research.checkedAt)} ·{" "}
        {simulated
          ? "Fictional customer, so no live search. Simulated from the ledger."
          : research.provider === "tavily"
            ? `Evidence from Tavily search and page extraction, ${research.judge?.provider === "openai"
              ? `judged by OpenAI ${research.judge.model}; each positive answer's quote was checked against its source`
              : research.judge?.provider === "rules" && research.judge.fallback
                ? "matched by fixed text rules because the model judge was unavailable"
                : "matched by fixed text rules"}`
            : "External check unavailable"}
        {research.domain && <> · billing domain <span className="break-all">{research.domain}</span></>}
      </p>
      {keys.some((key) => signals[key].sources.length > 0) && (
        <div className="mt-3 flex flex-col gap-3">
          {signals.website.sources.length > 0 && <EvidenceSources label="Homepage" items={signals.website.sources} />}
          {signals.webPresence.sources.length > 0 && <EvidenceSources label="Search results" items={signals.webPresence.sources} />}
          {signals.registry.sources.length > 0 && <EvidenceSources label="Registry listings" items={signals.registry.sources} />}
          {signals.news.sources.length > 0 && <EvidenceSources label="News" items={signals.news.sources} />}
        </div>
      )}
    </div>
  );
}

/** Receipts issued before multi-signal research keep their original layout. */
function LegacyResearchPanel({ customer, research }: { customer: CustomerRevenue; research?: CustomerResearch }) {
  const evidence = research?.evidence.map((item) => {
    let sourceDomain = item.sourceDomain;
    if (!sourceDomain) {
      try { sourceDomain = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ""); }
      catch { sourceDomain = "Source"; }
    }
    const domain = research.domain?.toLowerCase().replace(/^www\./, "");
    const kind = item.kind ?? (domain && (sourceDomain === domain || sourceDomain.endsWith(`.${domain}`))
      ? "billing_domain" : "supporting");
    return { ...item, kind, sourceDomain };
  }) ?? [];
  const domainEvidence = evidence.filter((item) => item.kind === "billing_domain");
  const supportingEvidence = evidence.filter((item) => item.kind === "supporting");
  // Tavily receipts issued before source classification used Verified only for this exact match.
  const officialDomainMatch = research?.officialDomainMatch ??
    (research?.provider === "tavily" && research.status === "Verified");
  return (
    <div className="rounded-[2px] border border-rule bg-sunken/40 p-3 text-xs leading-relaxed text-ink-soft">
      <p className="font-medium text-ink">External customer research{research?.provider === "simulated" ? " · simulated" : ""}</p>
      <p>{research?.reason ?? (customer.customerId ? "External research was not included when this receipt was issued." : "An aggregated or unattributed payment cannot identify an individual customer for research.")}</p>
      {research && <>
        <dl className="my-3 grid gap-px overflow-hidden rounded-[2px] border border-rule bg-rule sm:grid-cols-3">
          <div className="bg-paper p-2.5">
            <dt className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink-faint">Billing-domain match</dt>
            <dd className="mt-1 font-medium text-ink">{research.provider === "simulated" ? "Simulated" : officialDomainMatch ? "Name + domain matched" : "Not established"}</dd>
            {research.domain && <dd className="mt-0.5 break-all text-ink-faint">{research.domain}</dd>}
          </div>
          <div className="bg-paper p-2.5">
            <dt className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink-faint">Supporting sources</dt>
            <dd className="mt-1 font-medium text-ink">{research.provider === "simulated" ? "No live search" : `${supportingEvidence.length} retained`}</dd>
            <dd className="mt-0.5 text-ink-faint">Separate from the billing domain</dd>
          </div>
          <div className="bg-paper p-2.5">
            <dt className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink-faint">Legal registration</dt>
            <dd className="mt-1 font-medium text-ink">Not checked</dd>
            <dd className="mt-0.5 text-ink-faint">No registry adapter</dd>
          </div>
        </dl>
        <p>{research.registration}</p>
        <p>Checked {dayShort(research.checkedAt)} · {research.provider === "tavily" ? "Tavily web search" : research.provider === "simulated" ? "Demo fixture, no live search" : "External check unavailable"}</p>
        {evidence.length > 0 && <div className="mt-3 flex flex-col gap-3">
          {domainEvidence.length > 0 && <EvidenceSources label="Billing-domain evidence" items={domainEvidence} />}
          {supportingEvidence.length > 0 && <EvidenceSources label="Supporting web sources" items={supportingEvidence} />}
        </div>}
      </>}
    </div>
  );
}

/** How this month's revenue splits across research outcomes. */
export function CoverageSummary({ coverage, period }: { coverage: ResearchCoverage; period: string }) {
  const segments = [
    { key: "verified", label: "Verified", amount: coverage.verified, share: coverage.shares.verified, count: coverage.counts.verified, bar: "bg-verified" },
    { key: "needsReview", label: "Needs review", amount: coverage.needsReview, share: coverage.shares.needsReview, count: coverage.counts.needsReview, bar: "bg-inferred" },
    { key: "flagged", label: "Flagged", amount: coverage.flagged, share: coverage.shares.flagged, count: coverage.counts.flagged, bar: "bg-flagged" },
    { key: "unresearched", label: "Can't be researched", amount: coverage.unresearched, share: coverage.shares.unresearched, count: null, bar: "bg-rule-strong" },
  ].filter((segment) => segment.amount.minor > 0);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-paper px-4 py-4 sm:px-5">
      <p className="text-sm leading-relaxed text-ink">
        <span className="figures text-lg font-medium text-verified">{percent(coverage.verifiedShare)}</span>{" "}
        of {period} revenue comes from customers whose web presence checks out
        {coverage.simulated ? <span className="text-ink-soft"> (simulated research on fictional customers)</span> : ""}.
      </p>
      <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.key} className={`h-full ${segment.bar}`} style={{ width: `${(segment.share * 100).toFixed(1)}%` }} />
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        {segments.map((segment) => (
          <div key={segment.key}>
            <dt className="flex items-center gap-1.5 text-ink-faint">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${segment.bar}`} />
              {segment.label}{segment.count !== null ? ` · ${segment.count}` : ""}
            </dt>
            <dd className="figures mt-0.5 text-ink">{whole(segment.amount)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-relaxed text-ink-faint">
        Verified means the customer&apos;s own website or a search result on its billing domain names it. That confirms
        web presence, not legal identity or that payments are legitimate.
        {coverage.counts.adverseNews > 0 && ` ${coverage.counts.adverseNews === 1 ? "One customer has" : `${coverage.counts.adverseNews} customers have`} recent news with adverse terms.`}
      </p>
    </div>
  );
}

/** The largest vendors in the burn months, each checked live against the public web. */
export function VendorChecks({
  vendors,
  transactions,
}: {
  vendors: VendorLine[];
  transactions: Record<string, SnapshotTransaction>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SubHeading aside="live web check">Largest vendors</SubHeading>
      <p className="max-w-[62ch] text-xs leading-relaxed text-ink-soft">
        The largest payees across the burn months, including card purchases, which only reach cash burn when the card
        bill is paid. Vendors are real businesses even for sample companies, so they&apos;re searched live with Tavily. A
        match means a business by that name has a public footprint, not that it&apos;s the same business that was paid.
      </p>
      <div className="flex flex-col">
        {vendors.map((vendor) => (
          <details key={vendor.name} className="border-b border-rule/70 last:border-b-0">
            <summary className="flex items-baseline gap-2.5 py-2.5">
              <Chevron />
              <span className="min-w-0 truncate text-sm text-ink">{vendor.name}</span>
              <Chip tone={vendor.research.outcome === "found" ? "verified" : vendor.research.outcome === "not_found" ? "inferred" : "neutral"}>
                {vendor.research.outcome === "found" ? "Found" : vendor.research.outcome === "not_found" ? "No footprint" : "Unavailable"}
              </Chip>
              <span aria-hidden="true" className="flex-1" />
              <span className="figures whitespace-nowrap text-sm">{whole(vendor.spend)}</span>
            </summary>
            <div className="flex flex-col gap-2 pb-4 pl-5 text-xs leading-relaxed text-ink-soft">
              {vendor.research.summary && (
                <p className="border-l-2 border-rule-strong pl-2.5">
                  <span className="text-ink">{vendor.research.summary}</span>{" "}
                  <span className="text-ink-faint">Summary generated by Tavily from web sources; not verified.</span>
                </p>
              )}
              <p>{vendor.research.detail} Checked {dayShort(vendor.research.checkedAt)}.</p>
              {vendor.research.sources.length > 0 && <EvidenceSources label="Sources" items={vendor.research.sources} />}
              <TransactionRows ids={vendor.transactionIds} transactions={transactions} sort="size" limit={8} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function EvidenceSources({
  label,
  items,
}: {
  label: string;
  items: { title: string; url: string; excerpt: string; sourceDomain?: string; publishedDate?: string }[];
}) {
  return <section>
    <h5 className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink-faint">{label}</h5>
    <ul className="mt-1.5 flex flex-col gap-2">
      {items.map((item, index) => <li key={`${item.url}-${index}`} className="border-l-2 border-rule-strong pl-2.5">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">{item.title}</a>
        <p className="font-mono text-[0.62rem] text-ink-faint">{item.sourceDomain}{item.publishedDate ? ` · ${dayShort(item.publishedDate)}` : ""}</p>
        <p>{item.excerpt}</p>
      </li>)}
    </ul>
  </section>;
}
