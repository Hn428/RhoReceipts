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
    <main className="flex-1 px-4 py-10 sm:px-6 md:py-14">
      <article className="mx-auto flex max-w-5xl flex-col gap-9 rounded-lg border border-rule bg-paper px-5 py-8 shadow-[0_24px_60px_-48px_rgb(0_0_0/0.4)] sm:px-8 md:px-10">
        <header className="flex flex-col gap-5 border-b border-rule pb-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">{s.companyName} · Monthly receipt</p>
            <span className="rounded-full bg-verified-wash px-2.5 py-1 text-[0.64rem] font-semibold uppercase tracking-wide text-verified">Verified by Rho Receipts</span>
          </div>
          <h1 className="font-display text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.04em] md:text-[3rem]">{s.period.label}</h1>
          <p className="text-sm text-ink-soft">
            Monthly financial update derived from transaction activity. Issued {day(s.asOf)} and compared with {s.previousPeriod.label}.
          </p>
          {s.isDemo && (
            <p className="self-start rounded-[2px] border border-dashed border-rule-strong px-3 py-1.5 text-xs text-ink-soft">
              Sample company — figures come from a simulated ledger
            </p>
          )}
        </header>

        <section aria-label="Changes this month">
          <div aria-hidden="true" className="grid grid-cols-[1fr_5.5rem_5.5rem_4.5rem] gap-2 border-b border-rule bg-sunken px-3 py-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.09em] text-ink-faint sm:grid-cols-[1fr_8rem_8rem_6rem] sm:gap-3">
            <span>Metric</span>
            <span className="text-right">{s.period.label.split(" ")[0]}</span>
            <span className="text-right">{s.previousPeriod.label.split(" ")[0]}</span>
            <span className="text-right">Change</span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_5.5rem_5.5rem_4.5rem] items-baseline gap-2 border-b border-rule px-3 py-4 sm:grid-cols-[1fr_8rem_8rem_6rem] sm:gap-3">
              <span className="text-[0.9rem] font-medium text-ink">{row.label}</span>
              <span className="figures text-right text-base font-medium text-ink">{row.after}</span>
              <span className="figures text-right text-sm text-ink-faint">{row.before}</span>
              <span className={`figures text-right text-xs ${row.change && row.label === "MRR" ? "text-verified" : row.change && row.label === "Net burn" ? "text-inferred" : "text-ink-faint"}`}>{row.change ?? "—"}</span>
            </div>
          ))}
          {s.growth3Month !== null && (
            <p className="pt-3 text-xs text-ink-faint">
              Revenue growth over three months:{" "}
              <span className="figures text-ink-soft">{percent(s.growth3Month, { signed: true })}</span>
            </p>
          )}
        </section>

        {(s.newCustomers.length > 0 || s.missedCustomers.length > 0) && <section className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">What changed this month</h2>
        {s.newCustomers.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-verified">New customers</h3>
            {s.newCustomers.map((c) => (
              <div key={c.customerName} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.customerName}</span>
                <span className="figures">{whole(c.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {s.missedCustomers.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-inferred">No payment this month</h3>
            {s.missedCustomers.map((c) => (
              <div key={c.customerName} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.customerName}</span>
                <span className="figures text-ink-faint">{whole(c.previousAmount)} last month</span>
              </div>
            ))}
          </div>
        )}
        </section>}

        {s.flags.length > 0 && (
          <section className="flex flex-col gap-2 rounded-lg border border-inferred/35 bg-inferred-wash px-5 py-4">
            <h2 className="text-sm font-semibold text-inferred">Investor watch</h2>
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
