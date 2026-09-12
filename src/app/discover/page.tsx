import Link from "next/link";
import { discoverProfiles } from "@/lib/profiles";
import { percent, whole } from "@/lib/receipts/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor discovery · Rho Receipts" };

export default async function DiscoverPage() {
  const profiles = await discoverProfiles();
  return <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
    <header className="flex flex-col gap-4 border-b border-rule pb-8">
      <nav className="flex justify-between text-sm text-ink-soft"><Link href="/dashboard">Rho Receipts</Link><Link href="/enroll">Enroll your company →</Link></nav>
      <p className="text-xs uppercase tracking-widest text-ink-faint">Investor discovery</p>
      <h1 className="font-display text-4xl">Same questions. Different evidence.</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">Compare publicly listed companies, then open a receipt to inspect the records behind each figure.</p>
      <p className="text-xs text-ink-faint">Rho Receipts is an independent project, not a Rho product or certification. Sample companies and their research are simulated.</p>
    </header>
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {profiles.map((profile) => <article key={profile.slug} className="flex flex-col gap-5 rounded border border-rule bg-paper p-6">
        <div className="flex items-center gap-3">
          {profile.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.logoUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded object-contain" />
          )}
          <h2 className="font-display text-2xl">{profile.companyName}</h2>
        </div>
        <p className="text-xs text-verified">Bank-derived receipt{profile.isDemo ? " · simulated data" : ""}</p>
        <p className="min-h-[4.5rem] text-sm text-ink-soft"><span className="line-clamp-2">{profile.description || "No description provided."}</span><span className="block text-xs text-ink-faint">Founder-provided description</span></p>
        <p className="text-xs text-ink-faint">{profile.period}</p>
        <dl className="flex flex-col gap-3 text-sm">
          <Row label="Monthly recurring revenue" value={whole(profile.mrr)} />
          <Row label="Revenue growth, 3 months" value={percent(profile.growth, { signed: true })} />
          <Row label="Runway" value={profile.runway === null ? "Not burning" : `${profile.runway} months`} />
          <Row label="Largest customer" value={percent(profile.concentration)} />
          <Row label="Source" value="Bank records" />
          <Row label="Method" value="Calculated" />
          <Row label="Transaction evidence" value="Available" />
        </dl>
        <Link href={`/r/${profile.slug}`} className="mt-auto rounded bg-ink px-4 py-2.5 text-center text-sm text-paper">Open receipt →</Link>
      </article>)}
      <article className="flex flex-col gap-5 rounded border border-dashed border-rule-strong bg-sunken p-6">
        <h2 className="font-display text-2xl">BetaWorks</h2>
        <p className="text-xs text-inferred">Unverified · simulated company</p>
        <p className="min-h-[4.5rem] text-sm text-ink-soft"><span className="line-clamp-2">Workflow software for growing teams.</span><span className="block text-xs text-ink-faint">Founder-provided description</span></p>
        <p className="text-xs text-ink-faint">August 2026 · founder reported</p>
        <dl className="flex flex-col gap-3 text-sm">
          <Row label="Monthly recurring revenue" value="$60,000*" />
          <Row label="Revenue growth, 3 months" value="+35.0%*" />
          <Row label="Runway" value="18 months*" />
          <Row label="Largest customer" value="Unavailable" />
          <Row label="Source" value="Founder reported" />
          <Row label="Method" value="Unavailable" />
          <Row label="Transaction evidence" value="Unavailable" />
        </dl>
        <p className="text-xs text-ink-faint">*Illustrative claims, not checked against bank records.</p>
        <Link href="/discover/betaworks" className="mt-auto rounded border border-rule-strong px-4 py-2.5 text-center text-sm">Open founder profile →</Link>
      </article>
    </div>
    {profiles.length === 0 && <p className="text-sm text-ink-soft">No bank-derived profiles are listed yet. Founders can opt in from their dashboard.</p>}
  </main>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-rule pb-2"><dt className="text-ink-soft">{label}</dt><dd className="figures text-right">{value}</dd></div>;
}
