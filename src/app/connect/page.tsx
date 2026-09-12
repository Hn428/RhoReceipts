import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listConnections } from "@/lib/ingest/sync";

import { ConnectForm } from "./connect-form";

export const metadata = { title: "Connect Rho · Rho Receipts" };

const READS = [
  ["Accounts and balances", "to know your cash on hand"],
  ["Every transaction", "the evidence behind each figure"],
  ["Invoices and customers", "to confirm who paid you"],
] as const;

export default async function ConnectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const existing = await listConnections(session.user.id);

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 gap-12 px-6 py-14 md:grid-cols-[1.1fr_1fr] md:gap-16 md:py-20">
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint hover:text-ink"
          >
            Rho Receipts
          </Link>
          <h1 className="font-display text-4xl leading-[1.08] tracking-[-0.01em] md:text-5xl">
            Connect your bank ledger
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-ink-soft">
            Your receipt is built directly from Rho&apos;s records, so an
            investor can check every figure against the transactions that
            produced it. Nothing on it is typed in by you.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
            What we read
          </h2>
          <ul className="flex flex-col border-y border-rule">
            {READS.map(([what, why]) => (
              <li
                key={what}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-rule py-2.5 last:border-b-0"
              >
                <span className="text-sm text-ink">{what}</span>
                <span className="text-sm text-ink-faint">{why}</span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-ink">Read-only</dt>
            <dd className="text-ink-soft">
              The token can&apos;t move money or change anything in Rho.
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-ink">Encrypted at rest</dt>
            <dd className="text-ink-soft">
              Stored with AES-256-GCM and never shown back to anyone, including you.
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-4 self-start">
        <div className="perforated rounded-[2px] bg-paper px-6 py-8 shadow-[0_1px_0_var(--rule),0_12px_32px_-18px_rgb(0_0_0/0.25)] md:px-8">
          <ConnectForm sampleAvailable={Boolean(process.env.RHO_API_TOKEN)} />
        </div>
        {existing.length > 0 && (
          <p className="px-1 text-xs leading-relaxed text-ink-faint">
            Already connected: {existing.map((c) => c.label).join(", ")}.
            Connecting the same company again refreshes its data.
          </p>
        )}
      </section>
    </main>
  );
}
