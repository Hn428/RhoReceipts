import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { listConnections } from "@/lib/ingest/sync";
import { latestReceiptFor } from "@/lib/receipts";
import { recipientsFor, reportsFor } from "@/lib/reports";
import { day } from "@/lib/receipts/format";
import { getProfileSettings } from "@/lib/profiles";

import { addRecipient, issueFreshReceipt, removeRecipient, sendReportNow, updateProfile } from "./actions";

export const metadata = { title: "Dashboard · Rho Receipts" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const ownerId = session.user.id;
  const { error, saved } = await searchParams;

  const connections = await listConnections(ownerId);
  const withReceipts = await Promise.all(
    connections.map(async (connection) => ({
      connection,
      receipt: await latestReceiptFor(connection.id, ownerId),
      recipients: await recipientsFor(connection.id, ownerId),
      reports: await reportsFor(connection.id, ownerId),
      profile: await getProfileSettings(connection.id),
    })),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12 md:py-16">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-6">
        <div className="flex flex-col gap-1">
          <p className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">Rho Receipts</p>
          <h1 className="font-display text-3xl">Your receipts</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-faint">{session.user.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {saved === "profile" && <p role="status" className="text-sm text-verified">Profile settings saved.</p>}
      {error === "profile" && <p role="alert" className="text-sm text-flagged">Use a description of at most 500 characters and a valid HTTPS logo URL.</p>}
      {error === "email" && (
        <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">
          That email address doesn&apos;t look right. Check it and add the investor again.
        </p>
      )}
      {error === "report" && (
        <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">
          The monthly receipt couldn&apos;t be sent. Try again in a moment.
        </p>
      )}
      {error === "sync" && (
        <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">
          Couldn&apos;t pull the latest activity from Rho, so no new receipt was issued. Try again in a moment.
        </p>
      )}

      {withReceipts.length === 0 ? (
        <section className="perforated flex flex-col items-start gap-4 rounded-[2px] bg-paper px-8 py-10 shadow-[0_1px_0_var(--rule)]">
          <h2 className="font-display text-2xl">No company enrolled yet</h2>
          <p className="max-w-[48ch] text-sm leading-relaxed text-ink-soft">
            Enroll with a read-only Rho connection. You review what was found before anything is
            published.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/enroll" className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">
              Enroll in Rho Receipts
            </Link>
            <Link href="/mock-rho" className="text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
              Open the mock Rho environment
            </Link>
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <ul className="flex flex-col border-t border-rule">
            {withReceipts.map(({ connection, receipt, recipients, reports, profile }) => (
              <li key={connection.id} className="flex flex-col gap-4 border-b border-rule py-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <span className="font-display text-xl">{connection.label.replace(/\s*\(mock\)$/i, "")}</span>
                  <span className="figures text-xs text-ink-faint">
                    {connection.lastSyncedAt ? `Imported ${day(connection.lastSyncedAt.toISOString())}` : "Not imported yet"}
                    {receipt ? ` · Latest receipt ${day(receipt.createdAt.toISOString())}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {receipt ? (
                    <>
                      <Link
                        href={`/r/${receipt.slug}`}
                        className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:opacity-90"
                      >
                        Open receipt
                      </Link>
                      <form action={issueFreshReceipt}>
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <button
                          type="submit"
                          className="rounded-[3px] border border-rule-strong px-3.5 py-2 text-sm text-ink hover:bg-paper"
                        >
                          Issue a fresh receipt
                        </button>
                      </form>
                    </>
                  ) : (
                    <Link
                      href={`/enroll/${connection.id}`}
                      className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:opacity-90"
                    >
                      Review and generate
                    </Link>
                  )}
                </div>
                <form action={updateProfile} className="flex w-full flex-col gap-3 border-t border-dashed border-rule pt-5">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <h2 className="text-sm font-medium">Profile settings</h2>
                  <label className="flex flex-col gap-1 text-sm">Description
                    <textarea name="description" maxLength={500} defaultValue={profile.description} rows={3} className="rounded border border-rule-strong bg-paper p-2" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">Logo URL
                    <input name="logoUrl" type="url" placeholder="https://…" defaultValue={profile.logoUrl ?? ""} className="rounded border border-rule-strong bg-paper p-2" />
                  </label>
                  <label className="flex items-center gap-2 text-sm"><input name="isPublic" type="checkbox" defaultChecked={profile.isPublic} />List publicly in investor discovery</label>
                  <p className="text-xs leading-relaxed text-ink-faint">Unlisted profiles are still accessible to anyone with their link. Description and logo changes appear in discovery immediately and on your next receipt. Financial figures are calculated from bank records.</p>
                  <button type="submit" className="self-start rounded border border-rule-strong px-3 py-2 text-sm hover:bg-paper">Save profile settings</button>
                </form>
                {receipt && (
                  <div className="grid gap-6 border-t border-dashed border-rule pt-5 sm:basis-full sm:grid-cols-2">
                    <div className="flex flex-col gap-2.5">
                      <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
                        Investors receiving monthly receipts
                      </h2>
                      {recipients.length === 0 ? (
                        <p className="text-sm text-ink-faint">No investors added yet.</p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {recipients.map((r) => (
                            <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="truncate">
                                {r.name ? `${r.name} · ` : ""}
                                <span className="text-ink-soft">{r.email}</span>
                              </span>
                              <form action={removeRecipient}>
                                <input type="hidden" name="connectionId" value={connection.id} />
                                <input type="hidden" name="recipientId" value={r.id} />
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
                    <div className="flex flex-col gap-2.5">
                      <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
                        Monthly receipts
                      </h2>
                      <p className="text-xs leading-relaxed text-ink-faint">
                        Sent automatically on the 1st. Each investor gets each month once.
                      </p>
                      {reports.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {reports.map((r) => (
                            <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <Link href={`/m/${r.slug}`} className="underline-offset-4 hover:underline">
                                {r.snapshot.period.label}
                              </Link>
                              <span className="text-xs text-ink-faint">
                                sent to {r.deliveries.filter((d) => d.status === "sent").length} of {recipients.length}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <form action={sendReportNow}>
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <button type="submit" className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:opacity-90">
                          Send this month&apos;s receipt now
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/discover" className="text-ink-soft hover:underline">Investor discovery</Link>
            <Link href="/enroll" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
              Enroll another company
            </Link>
            <Link href="/mock-rho" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
              Mock Rho environment
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
