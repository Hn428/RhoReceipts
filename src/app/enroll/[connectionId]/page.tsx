import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { enrollmentSummary, ReceiptError } from "@/lib/receipts";
import { day } from "@/lib/receipts/format";

import { generateReceipt } from "../actions";

export const metadata = { title: "Review · Rho Receipts" };

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const { connectionId } = await params;
  const { error } = await searchParams;

  let summary;
  try {
    summary = await enrollmentSummary(connectionId, session.user.id);
  } catch (e) {
    if (e instanceof ReceiptError) notFound();
    throw e;
  }

  const figures = [
    { label: "Connected accounts", value: summary.accountCount.toLocaleString("en-US") },
    { label: "Transactions analysed", value: summary.transactionCount.toLocaleString("en-US") },
    {
      label: "Customers identified",
      value: summary.customersIdentified.toLocaleString("en-US"),
      note: `${summary.customersInvoiced} confirmed by invoice`,
    },
    {
      label: "Payments matched to invoices",
      value: summary.paymentsMatchedToInvoices.toLocaleString("en-US"),
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-14 md:py-20">
      <div className="flex flex-col gap-3">
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">Step 2 of 3 · Review</p>
        <h1 className="font-display text-4xl leading-[1.08] md:text-5xl">{summary.companyName}</h1>
        <p className="max-w-[52ch] text-base leading-relaxed text-ink-soft">
          Here is what Rho Receipts found in your bank records
          {summary.firstTransactionAt && summary.lastTransactionAt
            ? `, from ${day(summary.firstTransactionAt)} to ${day(summary.lastTransactionAt)}`
            : ""}
          . Nothing has been published yet.
        </p>
        {summary.isDemo && (
          <p className="self-start rounded-[2px] border border-dashed border-rule-strong px-3 py-1.5 text-xs text-ink-soft">
            Sample company from the mock Rho environment
          </p>
        )}
      </div>

      <section className="perforated rounded-[2px] bg-paper px-6 py-7 shadow-[0_1px_0_var(--rule),0_12px_32px_-18px_rgb(0_0_0/0.25)] md:px-8">
        <dl className="flex flex-col">
          {figures.map((f) => (
            <div key={f.label} className="flex items-baseline gap-3 border-b border-rule py-3.5 last:border-b-0">
              <dt className="flex flex-col gap-0.5">
                <span className="text-[0.95rem] text-ink">{f.label}</span>
                {f.note && <span className="text-xs text-ink-faint">{f.note}</span>}
              </dt>
              <span aria-hidden="true" className="min-w-6 flex-1 -translate-y-1 border-b border-dotted border-rule-strong" />
              <dd className="figures text-xl text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-col gap-4">
        <p className="max-w-[56ch] text-sm leading-relaxed text-ink-soft">
          Generating computes MRR, net burn, runway, growth and customer concentration from these
          records and publishes them as a shareable profile. You won&apos;t be able to edit the figures —
          that&apos;s what makes them worth trusting.
        </p>
        {error === "generate" && (
          <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">
            The receipt couldn&apos;t be generated. Try again.
          </p>
        )}
        <form action={generateReceipt} className="flex flex-wrap items-center gap-4">
          <input type="hidden" name="connectionId" value={summary.connectionId} />
          <button type="submit" className="rounded-[3px] bg-ink px-5 py-3 text-sm font-medium text-paper hover:opacity-90">
            Generate Rho Receipt
          </button>
          <Link href="/dashboard" className="text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
            Not now
          </Link>
        </form>
      </div>
    </main>
  );
}
