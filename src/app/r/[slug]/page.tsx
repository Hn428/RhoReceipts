import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { abs } from "@/lib/money";
import { getReceiptBySlug } from "@/lib/receipts";
import {
  ACCOUNT_TYPE_LABELS,
  EXCLUSION_EXPLANATIONS,
  EXCLUSION_LABELS,
  day,
  percent,
  plural,
  signed,
  whole,
} from "@/lib/receipts/format";

import {
  Chevron,
  Chip,
  CustomerLine,
  PayingCustomerRow,
  Method,
  MetricLine,
  Sparkline,
  SubHeading,
  Tick,
  TransactionRows,
} from "./parts";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const receipt = await getReceiptBySlug(slug);
  // Share links are private by default: never indexed by search engines.
  const robots = { index: false, follow: false };
  if (!receipt) return { title: "Receipt not found · Rho Receipts", robots };
  return {
    title: `${receipt.companyName} · Rho Receipt`,
    description: `Figures for ${receipt.snapshot.reportingPeriod.label}, verified against bank records.`,
    robots,
  };
}

export default async function ReceiptPage({ params }: Props) {
  const { slug } = await params;
  const receipt = await getReceiptBySlug(slug);
  if (!receipt) notFound();

  const s = receipt.snapshot;
  const { transactions } = s;
  const m = s.metrics;
  const cashAccounts = s.source.accounts.filter((a) => a.isCash);
  const otherAccounts = s.source.accounts.filter((a) => !a.isCash);

  // Older snapshots predate this field; treat them as having none.
  const prepayments = s.prepaymentsInPeriod?.value.minor ? s.prepaymentsInPeriod : null;
  const burnIn = m.netBurn.transactionIds.filter((id) => (transactions[id]?.amount.minor ?? 0) > 0);
  const burnOut = m.netBurn.transactionIds.filter((id) => (transactions[id]?.amount.minor ?? 0) < 0);

  // Older snapshots predate three-month growth; they fall back to month over month.
  const growth3 = s.metrics.growth3Month ?? null;
  const threeBack = s.revenueHistory.length >= 4 ? s.revenueHistory[s.revenueHistory.length - 4] : null;
  // Twelve months of payments per customer, for the payment-history view.
  const history = new Map(
    m.concentration.value.customers.map((c) => [c.customerId ?? c.customerName, c.transactionIds]),
  );

  const inferred = s.mrrCustomers.filter((c) => c.attribution === "name_match");
  const aggregated = s.mrrCustomers.filter((c) => c.attribution === "aggregated");
  const invoicedCount = s.mrrCustomers.filter((c) => c.attribution === "invoice").length;
  const flagCount = s.relatedParties.length + inferred.length + aggregated.length;

  return (
    <main className="flex-1 px-3 py-10 sm:px-6 md:py-16">
      <article className="perforated mx-auto flex max-w-[46rem] flex-col gap-10 rounded-[2px] bg-paper px-5 py-10 shadow-[0_1px_0_var(--rule),0_24px_48px_-28px_rgb(0_0_0/0.3)] sm:px-8 md:px-12 md:py-14">
        {/* ------------------------------------------------------ header */}
        <header className="flex flex-col gap-6 border-b border-rule pb-9">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-ink-soft">
              Receipt · Issued {day(s.asOf)}
            </p>
            <p className="figures text-[0.7rem] text-ink-faint">No. {receipt.slug}</p>
          </div>

          <div className="flex flex-col gap-3">
            {s.profile?.logoUrl && (
              // The browser loads founder-supplied logos; no server-side image fetch.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.profile.logoUrl} alt={`${s.companyName} logo`} referrerPolicy="no-referrer" className="h-14 w-14 rounded object-contain" />
            )}
            <h1 className="font-display text-[2.6rem] leading-[1.02] tracking-[-0.015em] md:text-[3.4rem]">
              {s.companyName}
            </h1>
            {s.profile?.description && <p className="text-sm leading-relaxed text-ink-soft">{s.profile.description}<span className="block text-xs text-ink-faint">Founder-provided description</span></p>}
            <p className="max-w-[54ch] text-[0.98rem] leading-relaxed text-ink-soft">
              Figures for <span className="text-ink">{s.reportingPeriod.label}</span>, computed
              from {plural(s.source.transactionCount, "bank transaction")} across{" "}
              {plural(s.source.accounts.length, "Rho account")}. Open any line to see the
              records behind it.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-2 rounded-[2px] border border-verified/40 bg-verified-wash px-2.5 py-1.5 font-mono text-[0.72rem] uppercase tracking-[0.1em] text-verified">
              <Tick /> Verified by Rho Receipts
            </span>
            <span className="text-xs text-ink-faint">
              Read-only bank connection · nothing entered by hand
            </span>
          </div>
          <p className="-mt-3 text-[0.7rem] leading-relaxed text-ink-faint">
            Rho Receipts is an independent project, not a Rho product. This badge is not a
            certification from Rho.
          </p>

          {s.isDemo && (
            <p className="rounded-[2px] border border-dashed border-rule-strong px-3 py-2 text-xs leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Sample company.</span> These figures come from
              a synthetic ledger built for demonstration, not from a real bank account.
            </p>
          )}
        </header>

        {/* ---------------------------------------------------- figures */}
        <section aria-labelledby="figures" className="flex flex-col">
          <h2 id="figures" className="sr-only">
            Figures
          </h2>

          <MetricLine
            label="Monthly recurring revenue"
            note={`from ${plural(m.mrr.transactionIds.length, "settled payment")}`}
            figure={whole(m.mrr.value)}
          >
            <Method>{m.mrr.method}</Method>
            <div className="flex flex-col">
              <SubHeading aside={whole(m.mrr.value)}>Revenue by customer</SubHeading>
              {s.mrrCustomers.map((customer) => (
                <CustomerLine
                  key={customer.customerId ?? customer.customerName}
                  customer={customer}
                  transactions={transactions}
                />
              ))}
            </div>
          </MetricLine>

          <MetricLine label="Annual run rate" figure={whole(m.arr.value)}>
            <Method>
              {m.arr.method} Open monthly recurring revenue above to see the payments it is built from.
            </Method>
          </MetricLine>

          <MetricLine
            label="Net burn"
            note={
              prepayments
                ? `lowered by ${whole(prepayments.value)} of prepayments`
                : plural(m.netBurn.transactionIds.length, "transaction")
            }
            figure={whole(m.netBurn.value)}
            unit="/mo"
          >
            <Method>{m.netBurn.method}</Method>
            {prepayments && (
              <div className="flex flex-col gap-2 rounded-[2px] border border-inferred/35 bg-inferred-wash px-4 py-3">
                <p className="text-sm leading-relaxed text-ink">
                  <span className="figures">{whole(prepayments.value)}</span> of this
                  month&apos;s money in was paid in advance for future months.{" "}
                  <span className="text-ink-soft">
                    It lowers this month&apos;s burn in full, so a typical month burns more than
                    this figure suggests.
                  </span>
                </p>
                <TransactionRows ids={prepayments.transactionIds} transactions={transactions} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <SubHeading aside={signed(s.operatingOut)}>Money out</SubHeading>
              <TransactionRows ids={burnOut} transactions={transactions} sort="size" />
            </div>
            <div className="flex flex-col gap-2">
              <SubHeading aside={signed(s.operatingIn)}>Money in</SubHeading>
              <TransactionRows ids={burnIn} transactions={transactions} sort="size" />
            </div>
          </MetricLine>

          <MetricLine
            label="Cash on hand"
            note={plural(cashAccounts.length, "account")}
            figure={whole(m.cashOnHand.value)}
          >
            <Method>{m.cashOnHand.method}</Method>
            <AccountTable accounts={cashAccounts} heading="Counted" total={whole(m.cashOnHand.value)} />
            {otherAccounts.length > 0 && (
              <AccountTable accounts={otherAccounts} heading="Not counted as cash" muted />
            )}
          </MetricLine>

          <MetricLine
            label="Runway"
            note={`at ${whole(s.averageMonthlyBurn)} a month`}
            figure={m.runwayMonths.value === null ? "Not burning" : `${m.runwayMonths.value} months`}
          >
            <Method>{m.runwayMonths.method}</Method>
            <div className="flex flex-col">
              <SubHeading aside={whole(s.averageMonthlyBurn)}>Net burn by month · average</SubHeading>
              {s.trailingBurn.map((month) => (
                <details key={month.periodKey} className="border-b border-rule/70 last:border-b-0">
                  <summary className="flex items-baseline gap-2.5 py-2.5">
                    <Chevron />
                    <span className="text-sm text-ink">{month.label}</span>
                    <span className="text-xs text-ink-faint">
                      {plural(month.transactionIds.length, "transaction")}
                    </span>
                    <span aria-hidden="true" className="flex-1" />
                    <span className="figures whitespace-nowrap text-sm">{whole(month.netBurn)}</span>
                  </summary>
                  <div className="pb-4 pl-5">
                    <TransactionRows ids={month.transactionIds} transactions={transactions} sort="size" limit={25} />
                  </div>
                </details>
              ))}
            </div>
          </MetricLine>

          <MetricLine
            label={growth3 ? "Revenue growth, 3 months" : "Growth, month over month"}
            note={
              growth3 && threeBack
                ? `since ${threeBack.label}`
                : s.previousPeriod
                  ? `vs ${s.previousPeriod.label}`
                  : undefined
            }
            figure={percent((growth3 ?? m.growthRate).value, { signed: true })}
          >
            <Method>{(growth3 ?? m.growthRate).method}</Method>
            <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
              {growth3 && threeBack && (
                <>
                  <dt className="text-ink-soft">{threeBack.label}</dt>
                  <dd className="figures text-right">{whole(threeBack.revenue)}</dd>
                </>
              )}
              {s.previousPeriod && (
                <>
                  <dt className="text-ink-soft">{s.previousPeriod.label}</dt>
                  <dd className="figures text-right">{whole(s.previousPeriod.revenue)}</dd>
                </>
              )}
              <dt className="text-ink">{s.reportingPeriod.label}</dt>
              <dd className="figures text-right text-ink">{whole(m.mrr.value)}</dd>
            </dl>
            {growth3 && (
              <p className="text-xs text-ink-faint">
                Month over month:{" "}
                <span className="figures text-ink-soft">{percent(m.growthRate.value, { signed: true })}</span>
              </p>
            )}
            <Sparkline
              points={s.revenueHistory.map((p) => ({ label: p.label, minor: p.revenue.minor }))}
            />
          </MetricLine>

          <MetricLine
            label="Largest customer"
            note={
              m.concentration.value.topCustomerName
                ? `${m.concentration.value.topCustomerName} · of revenue`
                : undefined
            }
            figure={percent(m.concentration.value.topCustomerShare)}
          >
            <Method>
              {m.concentration.method} The five largest account for{" "}
              <span className="figures text-ink">{percent(m.concentration.value.topFiveShare)}</span>.
              Aggregated processor payouts count as a single line because the customers inside
              them can&apos;t be told apart.
            </Method>
            <ul className="flex flex-col gap-2.5">
              {m.concentration.value.customers.slice(0, 8).map((c) => (
                <li key={c.customerId ?? c.customerName} className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-3 text-sm">
                  <span className="truncate text-ink">{c.customerName}</span>
                  <span className="h-1.5 bg-sunken">
                    <span
                      className="block h-full bg-verified"
                      style={{ width: `${((c.share ?? 0) * 100).toFixed(1)}%` }}
                    />
                  </span>
                  <span className="figures text-right text-ink-soft">{percent(c.share)}</span>
                </li>
              ))}
            </ul>
          </MetricLine>
        </section>

        {/* ------------------------------------------ paying customers */}
        <section aria-labelledby="customers" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="customers" className="font-display text-2xl">
              Paying customers
            </h2>
            <p className="max-w-[58ch] text-sm leading-relaxed text-ink-soft">
              {plural(invoicedCount, "customer")} confirmed by invoice in {s.reportingPeriod.label}.
              Open a customer to see their payment history.
            </p>
          </div>
          <div className="flex flex-col">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[1fr_7.5rem_9rem] gap-3 border-b border-rule pb-1.5 pl-[1.35rem] text-[0.68rem] font-medium uppercase tracking-[0.12em] text-ink-faint sm:grid"
            >
              <span>Customer</span>
              <span className="text-right">This month</span>
              <span>Verification</span>
            </div>
            {s.mrrCustomers.map((customer) => {
              const key = customer.customerId ?? customer.customerName;
              return (
                <PayingCustomerRow
                  key={key}
                  customer={customer}
                  historyIds={history.get(key) ?? customer.transactionIds}
                  transactions={transactions}
                  research={s.customerResearch?.[key]}
                />
              );
            })}
          </div>
        </section>

        {/* --------------------------------------------- closer look */}
        {flagCount > 0 && (
          <section aria-labelledby="closer" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 id="closer" className="font-display text-2xl">
                Worth a closer look
              </h2>
              <p className="max-w-[58ch] text-sm leading-relaxed text-ink-soft">
                Not errors, and not proof of anything — the places a careful investor would ask
                a follow-up question.
              </p>
            </div>
            <div className="flex flex-col border-t border-rule">
              {s.relatedParties.map((party) => (
                <FlagLine
                  key={party.customerName}
                  chip={<Chip tone="flagged">Related party</Chip>}
                  title={party.customerName}
                  body={
                    <>
                      Pays you and is paid by you:{" "}
                      <span className="figures text-ink">{whole(party.moneyIn)}</span> in,{" "}
                      <span className="figures text-ink">{whole(abs(party.moneyOut))}</span> out. Their
                      payments count as revenue; payments to them count as spend. Nothing is netted
                      away.
                    </>
                  }
                  ids={party.transactionIds}
                  transactions={transactions}
                />
              ))}
              {inferred.map((c) => (
                <FlagLine
                  key={c.customerName}
                  chip={<Chip tone="inferred">Needs review</Chip>}
                  title={c.customerName}
                  body={
                    <>
                      <span className="figures text-ink">{whole(c.amount)}</span> this month counted as
                      revenue because the bank description matches a customer on file, but no invoice
                      backs it.
                    </>
                  }
                  ids={c.transactionIds}
                  transactions={transactions}
                />
              ))}
              {aggregated.map((c) => (
                <FlagLine
                  key={c.customerName}
                  chip={<Chip tone="neutral">Aggregated</Chip>}
                  title={c.customerName}
                  body={
                    <>
                      <span className="figures text-ink">{whole(c.amount)}</span> this month arrived as
                      payment-processor payouts. It is real revenue, but which customers it came from
                      can&apos;t be determined from bank records.
                    </>
                  }
                  ids={c.transactionIds}
                  transactions={transactions}
                />
              ))}
            </div>
          </section>
        )}

        {/* ------------------------------------------------ left out */}
        <section aria-labelledby="excluded" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="excluded" className="font-display text-2xl">
              Left out of these figures
            </h2>
            <p className="max-w-[58ch] text-sm leading-relaxed text-ink-soft">
              Every transaction is accounted for. These were deliberately excluded, and here is why.
            </p>
          </div>
          <div className="flex flex-col border-t border-rule">
            {s.excluded.map((group) => (
              <details key={group.cashClass} className="border-b border-rule">
                <summary className="flex items-baseline gap-2.5 py-3">
                  <Chevron />
                  <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
                    <span className="text-sm text-ink">
                      {EXCLUSION_LABELS[group.cashClass] ?? group.cashClass}
                    </span>
                    <span className="text-xs text-ink-faint">{plural(group.count, "transaction")}</span>
                  </span>
                  <span aria-hidden="true" className="flex-1" />
                  <span className="figures whitespace-nowrap text-sm text-ink-soft">{signed(group.amount)}</span>
                </summary>
                <div className="flex flex-col gap-3 pb-5 pl-5">
                  <p className="max-w-[58ch] text-xs leading-relaxed text-ink-soft">
                    {EXCLUSION_EXPLANATIONS[group.cashClass] ?? group.reason}
                  </p>
                  <TransactionRows ids={group.transactionIds} transactions={transactions} limit={25} sort="size" />
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------- footer */}
        <footer className="flex flex-col gap-4 border-t border-rule pt-8 text-xs leading-relaxed text-ink-soft">
          <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink">
            How this receipt was made
          </h2>
          <ul className="flex max-w-[62ch] list-disc flex-col gap-1.5 pl-4 marker:text-ink-faint">
            <li>
              Transactions, balances and invoices were read from Rho through a read-only access
              token. No figure was typed in by a person or estimated by a model.
            </li>
            <li>
              Each figure is computed by fixed rules in code, and every line above opens to the
              transactions that produced it.
            </li>
            <li>
              The reporting month is the last complete one. A month still in progress would make
              burn look lower and runway longer than they are.
            </li>
            <li>
              Rho Receipts is an independent project built around the Rho ecosystem. It is not a
              Rho product, and the badge is not a certification from Rho.
            </li>
            <li>
              This receipt is a snapshot from {day(s.asOf)}. Later bank activity doesn&apos;t change
              it; a new receipt must be issued.
            </li>
          </ul>
          <p className="figures text-[0.68rem] text-ink-faint">
            Engine {s.engineVersion} · {plural(s.source.invoiceCount, "invoice")} ·{" "}
            {plural(s.source.customerCount, "customer")} on file
          </p>
        </footer>
      </article>
    </main>
  );
}

function AccountTable({
  accounts,
  heading,
  total,
  muted = false,
}: {
  accounts: { name: string; type: string; last4: string | null; balance: { minor: number; currency: string } }[];
  heading: string;
  total?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <SubHeading aside={total}>{heading}</SubHeading>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {accounts.map((account) => (
            <tr key={`${account.name}-${account.last4}`} className="border-b border-rule/70 last:border-b-0">
              <td className={`py-2 pr-3 ${muted ? "text-ink-soft" : "text-ink"}`}>{account.name}</td>
              <td className="figures whitespace-nowrap py-2 pr-3 text-xs text-ink-faint">
                {ACCOUNT_TYPE_LABELS[account.type] ?? account.type}
                {account.last4 ? ` ····${account.last4}` : ""}
              </td>
              <td className={`figures whitespace-nowrap py-2 text-right ${muted ? "text-ink-faint" : "text-ink"}`}>
                {signed(account.balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlagLine({
  chip,
  title,
  body,
  ids,
  transactions,
}: {
  chip: React.ReactNode;
  title: string;
  body: React.ReactNode;
  ids: string[];
  transactions: Parameters<typeof TransactionRows>[0]["transactions"];
}) {
  return (
    <details className="border-b border-rule">
      <summary className="flex items-baseline gap-2.5 py-3">
        <Chevron />
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{title}</span>
            {chip}
          </span>
          <span className="max-w-[58ch] text-sm leading-relaxed text-ink-soft">{body}</span>
        </span>
      </summary>
      <div className="pb-5 pl-5">
        <TransactionRows ids={ids} transactions={transactions} />
      </div>
    </details>
  );
}
