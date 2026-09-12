import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { connectionForOwner } from "@/lib/ingest/sync";
import { mockCompanies } from "@/lib/rho/mock/store";

import { EnrollForm } from "./enroll-form";

export const metadata = { title: "Enroll · Rho Receipts" };

const STEPS = [
  ["Connect", "Read-only access to accounts, transactions and invoices."],
  ["Review", "See what was found before a receipt is generated."],
  ["Generate", "Create a private verified receipt for your investors."],
] as const;

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (await connectionForOwner(session.user.id)) redirect("/dashboard");
  const { company } = await searchParams;

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-6 py-12 md:grid-cols-[1.15fr_0.85fr] md:gap-16 md:py-16">
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-verified">Founder setup</p>
          <h1 className="font-display text-4xl font-semibold leading-[1.04] tracking-[-0.04em] md:text-5xl">Connect your RHO account to generate a verified RHO Receipt</h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-ink-soft">
            Your figures are computed from bank records, not typed in — so an investor can open
            any number and see the transactions behind it.
          </p>
        </div>

        <ol className="flex flex-col overflow-hidden rounded-lg border border-rule bg-paper">
          {STEPS.map(([step, detail], index) => (
            <li key={step} className="flex gap-4 border-b border-rule px-5 py-4 last:border-b-0">
              <span className="figures flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-verified-wash text-xs text-verified">{index + 1}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">{step}</span>
                <span className="text-sm text-ink-soft">{detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="max-w-[48ch] text-xs leading-relaxed text-ink-faint">
          You&apos;ll be able to choose which investors receive monthly receipts. You won&apos;t
          be able to edit any financial figure.
        </p>
      </section>

      <section className="self-start">
        <div className="rounded-lg border border-rule bg-paper px-6 py-8 shadow-[0_18px_45px_-34px_rgb(0_0_0/0.35)] md:px-8">
          <EnrollForm
            preselected={company}
            samples={mockCompanies.map((c) => ({
              slug: c.meta.slug,
              name: c.meta.short_name,
              description: c.meta.description,
            }))}
          />
        </div>
      </section>
    </main>
  );
}
