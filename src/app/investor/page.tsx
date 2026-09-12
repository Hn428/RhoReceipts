import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { auth, signOut } from "@/auth";
import { receiptsSharedWithInvestor } from "@/lib/receipts/sharing";
import { reportsSharedWithInvestor } from "@/lib/reports";
import { day, percent, whole } from "@/lib/receipts/format";
import { VIEW_ROLE_COOKIE } from "@/lib/view-role";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor portfolio · Rho Receipts" };

export default async function InvestorPortfolioPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin?callbackUrl=/investor");
  if ((await cookies()).get(VIEW_ROLE_COOKIE)?.value === "founder") redirect("/dashboard");

  const email = session.user.email.trim().toLowerCase();
  const [sharedReceipts, reports] = await Promise.all([
    receiptsSharedWithInvestor(email),
    reportsSharedWithInvestor(email),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-10 sm:px-6 md:py-14">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-rule pb-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-verified">Private investor view</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Your shared receipts</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">
            Only receipts founders shared directly with {email}, plus monthly updates delivered to it, appear here.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-faint">{email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {sharedReceipts.length === 0 && reports.length === 0 ? (
        <section className="mt-8 rounded-lg border border-dashed border-rule-strong bg-paper px-6 py-14 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">No shared receipts</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">Nothing has been shared with this email yet</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-ink-soft">
            Ask the founder to open a receipt and share it with <span className="figures text-ink">{email}</span>.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-10">
          {sharedReceipts.length > 0 && (
            <section aria-labelledby="direct-receipts" className="mt-8">
              <div className="border-b border-rule pb-3">
                <h2 id="direct-receipts" className="text-lg font-semibold">Receipts shared with you</h2>
                <p className="mt-1 text-xs text-ink-faint">Each row is the exact frozen receipt selected by its founder.</p>
              </div>
              <div className="overflow-hidden rounded-b-lg border-x border-b border-rule bg-paper">
                <div className="hidden grid-cols-[minmax(15rem,1.4fr)_repeat(3,minmax(8rem,1fr))_auto] border-b border-rule bg-sunken px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-ink-faint md:grid">
                  <span>Company</span><span>MRR</span><span>Runway</span><span>Growth</span><span>Receipt</span>
                </div>
                {sharedReceipts.map((receipt) => {
                  const metrics = receipt.snapshot.metrics;
                  const growth = metrics.growth3Month ?? metrics.growthRate;
                  return (
                    <article key={receipt.shareId} className="grid gap-5 border-b border-rule px-5 py-6 last:border-b-0 md:grid-cols-[minmax(15rem,1.4fr)_repeat(3,minmax(8rem,1fr))_auto] md:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-ink font-semibold text-paper">{receipt.companyName[0]}</span>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-ink">{receipt.companyName}</h3>
                          <p className="mt-1 text-xs text-ink-faint">Figures through {day(receipt.asOf.toISOString())} · {receipt.snapshot.isDemo ? "Simulated data" : "Bank-derived"}</p>
                        </div>
                      </div>
                      <Metric label="MRR" value={whole(metrics.mrr.value)} />
                      <Metric label="Runway" value={metrics.runwayMonths.value === null ? "Not burning" : `${metrics.runwayMonths.value} months`} />
                      <Metric label="3-month growth" value={percent(growth.value, { signed: true })} positive={growth.value !== null && growth.value > 0} />
                      <div className="md:text-right">
                        <Link href={`/r/${receipt.slug}`} className="inline-block rounded bg-ink px-3 py-2 text-xs font-semibold text-paper hover:opacity-90">Open receipt</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {reports.length > 0 && (
            <section aria-labelledby="monthly-updates" className={sharedReceipts.length > 0 ? "" : "mt-8"}>
              <div className="border-b border-rule pb-3">
                <h2 id="monthly-updates" className="text-lg font-semibold">Monthly updates</h2>
                <p className="mt-1 text-xs text-ink-faint">Updates delivered by founders who added this email to monthly delivery.</p>
              </div>
              <div className="overflow-hidden rounded-b-lg border-x border-b border-rule bg-paper">
                <div className="hidden grid-cols-[minmax(15rem,1.4fr)_repeat(3,minmax(8rem,1fr))_auto] border-b border-rule bg-sunken px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-ink-faint md:grid">
                  <span>Company</span><span>MRR</span><span>Runway</span><span>Growth</span><span>Update</span>
                </div>
                {reports.map((report) => {
                  const snapshot = report.snapshot;
                  return (
                    <article key={report.id} className="grid gap-5 border-b border-rule px-5 py-6 last:border-b-0 md:grid-cols-[minmax(15rem,1.4fr)_repeat(3,minmax(8rem,1fr))_auto] md:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-ink font-semibold text-paper">{report.companyName[0]}</span>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-ink">{report.companyName}</h3>
                          <p className="mt-1 text-xs text-ink-faint">{snapshot.period.label} · {snapshot.isDemo ? "Simulated data" : "Bank-derived"}</p>
                        </div>
                      </div>
                      <Metric label="MRR" value={whole(snapshot.mrr.current)} />
                      <Metric label="Runway" value={snapshot.runwayMonths.current === null ? "Not burning" : `${snapshot.runwayMonths.current} months`} />
                      <Metric label="3-month growth" value={percent(snapshot.growth3Month, { signed: true })} positive={snapshot.growth3Month !== null && snapshot.growth3Month > 0} />
                      <div className="flex flex-wrap gap-3 md:justify-end">
                        <Link href={`/m/${report.slug}`} className="rounded bg-ink px-3 py-2 text-xs font-semibold text-paper hover:opacity-90">Monthly receipt</Link>
                        <Link href={`/r/${report.receiptSlug}`} className="self-center text-xs font-medium text-verified hover:underline">Evidence</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      <footer className="mt-5 text-xs leading-5 text-ink-faint">
        Direct shares grant access to one receipt. Monthly access follows the founder&apos;s current investor list. Rho Receipts is an independent project, not a Rho product or certification.
      </footer>
    </main>
  );
}

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint md:hidden">{label}</p>
      <p className={`figures mt-1 text-lg font-medium ${positive ? "text-verified" : "text-ink"}`}>{value}</p>
    </div>
  );
}
