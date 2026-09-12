import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { describeFlag, getReportBySlug } from "@/lib/reports";
import { day, percent, whole } from "@/lib/receipts/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const report = await getReportBySlug(slug);
  const robots = { index: false, follow: false };
  if (!report) return { title: "Receipt not found · Rho Receipts", robots };
  return { title: `${report.companyName} — ${report.snapshot.period.label} receipt`, robots };
}

export default async function MonthlyReceiptPage({ params }: Props) {
  const { slug } = await params;
  const report = await getReportBySlug(slug);
  if (!report) notFound();
  const s = report.snapshot;
  const runway = (m: number | null) => (m === null ? "—" : `${m}`);

  const rows = [
    {
      label: "MRR",
      before: s.mrr.previous ? whole(s.mrr.previous) : "—",
      after: whole(s.mrr.current),
      change: s.mrr.change !== null ? percent(s.mrr.change, { signed: true }) : null,
    },
    {
      label: "Net burn",
      before: s.netBurn.previous ? whole(s.netBurn.previous) : "—",
      after: whole(s.netBurn.current),
      change: s.netBurn.change !== null ? percent(s.netBurn.change, { signed: true }) : null,
    },
    { label: "Runway, months", before: runway(s.runwayMonths.previous), after: runway(s.runwayMonths.current), change: null },
    {
      label: "Largest customer",
      before: percent(s.topCustomer.previous.share),
      after: percent(s.topCustomer.current.share),
      change: null,
    },
  ];

  return (
    <main className="flex-1 px-3 py-10 sm:px-6 md:py-16">
      <article className="perforated mx-auto flex max-w-[40rem] flex-col gap-9 rounded-[2px] bg-paper px-5 py-10 shadow-[0_1px_0_var(--rule),0_24px_48px_-28px_rgb(0_0_0/0.3)] sm:px-8 md:px-11">
        <header className="flex flex-col gap-3 border-b border-rule pb-7">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-ink-soft">
            Monthly receipt · Issued {day(s.asOf)}
          </p>
          <h1 className="font-display text-[2.4rem] leading-[1.04] md:text-[3rem]">
            {s.companyName}
            <span className="block text-ink-soft">{s.period.label}</span>
          </h1>
          <p className="text-sm text-ink-soft">
            Compared with {s.previousPeriod.label}. Every figure is computed from bank records.
          </p>
          {s.isDemo && (
            <p className="self-start rounded-[2px] border border-dashed border-rule-strong px-3 py-1.5 text-xs text-ink-soft">
              Sample company — figures come from a simulated ledger
            </p>
          )}
        </header>

        <section aria-label="Changes this month">
          <div aria-hidden="true" className="grid grid-cols-[1fr_6.5rem_6.5rem] gap-3 border-b border-rule pb-1.5 text-[0.68rem] uppercase tracking-[0.12em] text-ink-faint">
            <span />
            <span className="text-right">{s.previousPeriod.label.split(" ")[0]}</span>
            <span className="text-right">{s.period.label.split(" ")[0]}</span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_6.5rem_6.5rem] items-baseline gap-3 border-b border-rule py-3.5">
              <span className="flex flex-col">
                <span className="text-[0.95rem] text-ink">{row.label}</span>
                {row.change && <span className="figures text-xs text-ink-faint">{row.change}</span>}
              </span>
              <span className="figures text-right text-sm text-ink-faint">{row.before}</span>
              <span className="figures text-right text-lg text-ink">{row.after}</span>
            </div>
          ))}
          {s.growth3Month !== null && (
            <p className="pt-3 text-xs text-ink-faint">
              Revenue growth over three months:{" "}
              <span className="figures text-ink-soft">{percent(s.growth3Month, { signed: true })}</span>
            </p>
          )}
        </section>

        {s.newCustomers.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink-soft">New customers</h2>
            {s.newCustomers.map((c) => (
              <div key={c.customerName} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.customerName}</span>
                <span className="figures">{whole(c.amount)}</span>
              </div>
            ))}
          </section>
        )}

        {s.missedCustomers.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink-soft">No payment this month</h2>
            {s.missedCustomers.map((c) => (
              <div key={c.customerName} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.customerName}</span>
                <span className="figures text-ink-faint">{whole(c.previousAmount)} last month</span>
              </div>
            ))}
          </section>
        )}

        {s.flags.length > 0 && (
          <section className="flex flex-col gap-2 rounded-[2px] border border-inferred/35 bg-inferred-wash px-4 py-3.5">
            <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-inferred">Worth a look</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed text-ink marker:text-inferred">
              {s.flags.map((flag, i) => (
                <li key={i}>{describeFlag(flag)}</li>
              ))}
            </ul>
          </section>
        )}

        <footer className="flex flex-col gap-3 border-t border-rule pt-6">
          <Link href={`/r/${s.receiptSlug}`} className="self-start rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">
            See every transaction behind these figures
          </Link>
          <p className="text-xs leading-relaxed text-ink-faint">
            Rho Receipts is an independent project, not a Rho product. This receipt is a snapshot and
            doesn&apos;t change after it is issued.
          </p>
        </footer>
      </article>
    </main>
  );
}
