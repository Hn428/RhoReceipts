import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { connectionForOwner } from "@/lib/ingest/sync";
import { receiptsFor } from "@/lib/receipts";
import { day } from "@/lib/receipts/format";
import { recipientsFor, reportsFor } from "@/lib/reports";
import { VIEW_ROLE_COOKIE } from "@/lib/view-role";

import { addRecipient, issueFreshReceipt, removeRecipient, sendReportNow } from "./actions";

export const metadata = { title: "Dashboard · Rho Receipts" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if ((await cookies()).get(VIEW_ROLE_COOKIE)?.value === "investor") redirect("/investor");

  const ownerId = session.user.id;
  const { error } = await searchParams;
  const connection = await connectionForOwner(ownerId);
  const company = connection
    ? await Promise.all([
        receiptsFor(connection.id, ownerId),
        recipientsFor(connection.id, ownerId),
        reportsFor(connection.id, ownerId),
      ]).then(([receipts, recipients, reports]) => ({ receipts, recipients, reports }))
    : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-9 px-6 py-12 md:py-16">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-6">
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">Founder dashboard</p>
          <h1 className="mt-1 font-display text-3xl">Your company receipts</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-faint">{session.user.email}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <button type="submit" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">Sign out</button>
          </form>
        </div>
      </header>

      {error === "email" && <Alert>That email address doesn&apos;t look right. Check it and add the investor again.</Alert>}
      {error === "report" && <Alert>The monthly receipt couldn&apos;t be sent. Try again in a moment.</Alert>}
      {error === "sync" && <Alert>Couldn&apos;t pull the latest activity from Rho, so no new receipt was issued. Try again in a moment.</Alert>}

      {!connection || !company ? (
        <section className="perforated flex flex-col items-start gap-4 rounded-[2px] bg-paper px-8 py-10 shadow-[0_1px_0_var(--rule)]">
          <h2 className="font-display text-2xl">Set up your company</h2>
          <p className="max-w-[48ch] text-sm leading-relaxed text-ink-soft">
            Connect one company with read-only Rho access. Once connected, this dashboard becomes its receipt history.
          </p>
          <Link href="/enroll" className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">Start setup</Link>
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-5 rounded-lg border border-rule bg-paper px-6 py-6">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">Connected company</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">{connection.label.replace(/\s*\(mock\)$/i, "")}</h2>
              <p className="figures mt-1 text-xs text-ink-faint">
                {connection.lastSyncedAt ? `Last imported ${day(connection.lastSyncedAt.toISOString())}` : "Waiting for first import"}
              </p>
            </div>
            {company.receipts.length > 0 ? (
              <form action={issueFreshReceipt}>
                <input type="hidden" name="connectionId" value={connection.id} />
                <button type="submit" className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">Generate new receipt</button>
              </form>
            ) : (
              <Link href={`/enroll/${connection.id}`} className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">Review and generate</Link>
            )}
          </section>

          <section>
            <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
              <h2 className="text-lg font-semibold">Receipt history</h2>
              <span className="figures text-xs text-ink-faint">{company.receipts.length} total</span>
            </div>
            {company.receipts.length === 0 ? (
              <p className="py-8 text-sm text-ink-faint">No receipts generated yet.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {company.receipts.map((receipt, index) => (
                  <li key={receipt.slug} className="flex flex-wrap items-center justify-between gap-4 py-4">
                    <div>
                      <p className="text-sm font-medium">{index === 0 ? "Latest receipt" : "Receipt"} · {day(receipt.createdAt.toISOString())}</p>
                      <p className="figures mt-1 text-xs text-ink-faint">Figures through {day(receipt.asOf.toISOString())} · Engine {receipt.engineVersion}</p>
                    </div>
                    <Link href={`/r/${receipt.slug}`} className="rounded-[3px] border border-rule-strong px-3 py-2 text-sm hover:bg-paper">Open receipt</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {company.receipts.length > 0 && (
            <section className="grid gap-8 border-t border-rule pt-7 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Investor access</h2>
                <p className="text-xs leading-relaxed text-ink-faint">Add investors who should receive every monthly update. To share one receipt, open it from the history above.</p>
                {company.recipients.length === 0 ? <p className="text-sm text-ink-faint">No investors added yet.</p> : (
                  <ul className="flex flex-col gap-2">
                    {company.recipients.map((recipient) => (
                      <li key={recipient.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">{recipient.name ? `${recipient.name} · ` : ""}<span className="text-ink-soft">{recipient.email}</span></span>
                        <form action={removeRecipient}>
                          <input type="hidden" name="connectionId" value={connection.id} />
                          <input type="hidden" name="recipientId" value={recipient.id} />
                          <button type="submit" className="text-xs text-ink-faint hover:text-flagged">Remove</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={addRecipient} className="flex flex-wrap gap-2">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input name="name" placeholder="Name" aria-label="Investor name" className="w-28 rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1.5 text-sm" />
                  <input name="email" type="email" required placeholder="investor@fund.com" aria-label="Investor email" className="min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1.5 text-sm" />
                  <button type="submit" className="rounded-[3px] border border-rule-strong px-3 py-1.5 text-sm hover:bg-paper">Add</button>
                </form>
              </div>

              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Monthly delivery</h2>
                <p className="text-xs leading-relaxed text-ink-faint">Runs automatically on the 1st. Each investor receives each month once.</p>
                {company.reports.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {company.reports.map((report) => (
                      <li key={report.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <Link href={`/m/${report.slug}`} className="underline-offset-4 hover:underline">{report.snapshot.period.label}</Link>
                        <span className="text-xs text-ink-faint">sent to {report.deliveries.filter((delivery) => delivery.status === "sent").length}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={sendReportNow}>
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <button type="submit" className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:opacity-90">Send this month&apos;s receipt now</button>
                </form>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">{children}</p>;
}
