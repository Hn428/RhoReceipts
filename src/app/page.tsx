/* eslint-disable @next/next/no-html-link-for-pages -- role selection must load its cookie-setting route handler as a document navigation */
export default function Home() {
  return <main className="flex flex-1 flex-col bg-sunken">
    <header className="border-b border-white/10 bg-ink text-paper">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6" aria-label="Landing">
        <span className="text-xs font-semibold tracking-[0.12em]">RHO RECEIPTS</span>
        <div className="flex items-center gap-5 text-sm text-zinc-300">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="/auth/view/founder" className="hidden hover:text-white sm:inline">Founder sign in</a>
          <a href="/auth/view/investor" className="rounded border border-white/25 px-3 py-1.5 hover:bg-white/10">Investor sign in</a>
        </div>
      </nav>
    </header>

    <section className="grid min-h-[38rem] bg-ink text-white lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-20 sm:px-12 lg:px-[max(3rem,calc((100vw-80rem)/2))] lg:pr-16">
        <p className="mb-7 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Verified by Rho Receipts
        </p>
        <h1 className="max-w-[12ch] text-5xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-6xl">Every financial claim, <span className="text-emerald-400">verified.</span></h1>
        <p className="mt-7 max-w-[36rem] text-base leading-7 text-zinc-300">Rho Receipts calculates MRR, burn and runway directly from bank transaction data. Founders share private verified receipts. Investors audit the records behind them.</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a href="/auth/view/founder" className="rounded bg-white px-5 py-3 text-sm font-semibold text-ink hover:bg-zinc-100">I&apos;m a Founder →</a>
          <a href="/auth/view/investor" className="rounded border border-white/25 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">I&apos;m an Investor →</a>
        </div>
        <p className="mt-5 text-xs text-zinc-500">Read-only access · figures cannot be edited by founders</p>
      </div>

      <div className="flex items-center justify-center bg-[#222225] px-6 py-14">
        <article className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-white text-ink shadow-2xl">
          <div className="flex items-center justify-between border-b border-rule px-6 py-4">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded bg-ink font-semibold text-white">A</span><div><p className="font-semibold">Acme AI</p><p className="text-xs text-ink-faint">Document intelligence</p></div></div>
            <span className="rounded-full bg-verified-wash px-2.5 py-1 text-[0.64rem] font-semibold uppercase tracking-wide text-verified">Verified</span>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
            <PreviewMetric label="MRR" value="$53.3K" />
            <PreviewMetric label="Runway" value="12.3 mo" />
            <PreviewMetric label="Growth" value="+31.0%" positive />
          </dl>
          <div className="px-6 py-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Paying customers</p>{[["Tessellate Health","$14,800"],["Halberd Genomics","$8,400"],["Parlour Commerce","$6,200"]].map(([name,value]) => <div key={name} className="flex items-center border-t border-rule py-2.5 text-sm"><span className="flex-1">{name}</span><span className="figures mr-4">{value}</span><span className="text-xs text-verified">Verified</span></div>)}</div>
          <p className="border-t border-rule bg-sunken px-6 py-3 text-xs text-ink-faint">All values derived from a simulated bank ledger</p>
        </article>
      </div>
    </section>

    <section id="how" className="mx-auto w-full max-w-7xl px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-verified">How it works</p>
      <div className="mt-7 grid border-y border-rule md:grid-cols-3 md:divide-x md:divide-rule">
        {[["01","Connect your company","Rho Receipts reads transaction history and invoices through read-only access."],["02","Metrics are calculated","MRR, burn, runway and growth are derived from settled transactions."],["03","Share a verified receipt","Investors receive a link and can trace every figure to its evidence."]].map(([number,title,copy]) => <article key={number} className="py-8 md:px-8 md:first:pl-0"><span className="figures text-xs text-verified">{number}</span><h2 className="mt-5 text-lg font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-ink-soft">{copy}</p></article>)}
      </div>
    </section>
  </main>;
}

function PreviewMetric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <div className="p-5"><dt className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt><dd className={`figures mt-2 text-lg font-medium ${positive ? "text-verified" : ""}`}>{value}</dd></div>;
}
