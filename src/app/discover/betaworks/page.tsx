import Link from "next/link";

export const metadata = { title: "BetaWorks · Founder-reported profile" };

export default function BetaWorksPage() {
  return <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-7 px-6 py-12">
    <Link href="/discover" className="text-sm text-ink-soft">← Investor discovery</Link>
    <header className="flex flex-col gap-3 border-b border-rule pb-6">
      <p className="text-xs uppercase tracking-widest text-inferred">Not enrolled · unverified</p>
      <h1 className="font-display text-4xl">BetaWorks</h1>
      <p className="text-sm text-ink-soft">Workflow software for growing teams. Founder-provided description.</p>
      <p className="rounded border border-dashed border-rule-strong p-3 text-xs text-ink-soft">Simulated comparison company. These illustrative claims have no bank connection or financial evidence.</p>
    </header>
    <p className="text-sm text-ink-soft">August 2026 · founder reported</p>
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <dt>Monthly recurring revenue</dt><dd className="figures text-right">$60,000 · founder reported</dd>
      <dt>Revenue growth, 3 months</dt><dd className="figures text-right">+35.0% · founder reported</dd>
      <dt>Runway</dt><dd className="figures text-right">18 months · founder reported</dd>
      <dt>Largest customer</dt><dd className="text-right text-ink-faint">Unavailable</dd>
      <dt>Calculation method</dt><dd className="text-right text-ink-faint">Unavailable</dd>
      <dt>Customer verification</dt><dd className="text-right text-ink-faint">Unavailable</dd>
      <dt>Underlying transactions</dt><dd className="text-right text-ink-faint">Unavailable</dd>
      <dt>Monthly investor receipt</dt><dd className="text-right text-ink-faint">Unavailable</dd>
    </dl>
    <p className="border-t border-rule pt-5 text-sm text-ink-soft">BetaWorks has not enrolled. There is no receipt to audit and no verification badge.</p>
    <footer className="text-xs text-ink-faint">Rho Receipts is an independent project, not a Rho product or certification.</footer>
  </main>;
}
