import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { listConnections } from "@/lib/ingest/sync";
import { latestReceiptFor } from "@/lib/receipts";
import { day } from "@/lib/receipts/format";

import { issueFreshReceipt } from "./actions";

export const metadata = { title: "Dashboard · Rho Receipts" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const ownerId = session.user.id;
  const { error } = await searchParams;

  const connections = await listConnections(ownerId);
  const withReceipts = await Promise.all(
    connections.map(async (connection) => ({
      connection,
      receipt: await latestReceiptFor(connection.id, ownerId),
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

      {error === "sync" && (
        <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">
          Couldn&apos;t pull the latest activity from Rho, so no new receipt was issued. Try again in a moment.
        </p>
      )}

      {withReceipts.length === 0 ? (
        <section className="perforated flex flex-col items-start gap-4 rounded-[2px] bg-paper px-8 py-10 shadow-[0_1px_0_var(--rule)]">
          <h2 className="font-display text-2xl">No bank account connected yet</h2>
          <p className="max-w-[48ch] text-sm leading-relaxed text-ink-soft">
            Connect Rho with a read-only token. Your first receipt is generated as soon as your
            transactions are imported.
          </p>
          <Link href="/connect" className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">
            Connect Rho
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <ul className="flex flex-col border-t border-rule">
            {withReceipts.map(({ connection, receipt }) => (
              <li key={connection.id} className="flex flex-col gap-4 border-b border-rule py-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <span className="font-display text-xl">{connection.label.replace(/\s*\(mock\)$/i, "")}</span>
                  <span className="figures text-xs text-ink-faint">
                    {connection.lastSyncedAt ? `Imported ${day(connection.lastSyncedAt.toISOString())}` : "Not imported yet"}
                    {receipt ? ` · Latest receipt ${day(receipt.createdAt.toISOString())}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {receipt && (
                    <Link
                      href={`/r/${receipt.slug}`}
                      className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:opacity-90"
                    >
                      Open receipt
                    </Link>
                  )}
                  <form action={issueFreshReceipt}>
                    <input type="hidden" name="connectionId" value={connection.id} />
                    <button
                      type="submit"
                      className="rounded-[3px] border border-rule-strong px-3.5 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {receipt ? "Issue a fresh receipt" : "Issue receipt"}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/connect" className="self-start text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
            Connect another account
          </Link>
        </section>
      )}
    </main>
  );
}
