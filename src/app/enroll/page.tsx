import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { mockCompanies } from "@/lib/rho/mock/store";

import { EnrollForm } from "./enroll-form";

export const metadata = { title: "Enroll · Rho Receipts" };

const STEPS = [
  ["Connect", "Read-only access to accounts, transactions and invoices."],
  ["Review", "See what was found before anything is published."],
  ["Generate", "Publish a verified profile to share with investors."],
] as const;

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const { company } = await searchParams;

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 gap-12 px-6 py-14 md:grid-cols-[1.1fr_1fr] md:gap-16 md:py-20">
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <Link href="/dashboard" className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint hover:text-ink">
            Rho Receipts
          </Link>
          <h1 className="font-display text-4xl leading-[1.08] tracking-[-0.01em] md:text-5xl">
            Turn your financial activity into a verified investor profile
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-ink-soft">
            Your figures are computed from bank records, not typed in — so an investor can open
            any number and see the transactions behind it.
          </p>
        </div>

        <ol className="flex flex-col border-y border-rule">
          {STEPS.map(([step, detail], index) => (
            <li key={step} className="flex gap-4 border-b border-rule py-3 last:border-b-0">
              <span className="figures pt-px text-xs text-ink-faint">{index + 1}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">{step}</span>
                <span className="text-sm text-ink-soft">{detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="max-w-[48ch] text-xs leading-relaxed text-ink-faint">
          You&apos;ll be able to edit your company description and choose which investors receive
          monthly receipts. You won&apos;t be able to edit any financial figure.
        </p>
      </section>

      <section className="self-start">
        <div className="perforated rounded-[2px] bg-paper px-6 py-8 shadow-[0_1px_0_var(--rule),0_12px_32px_-18px_rgb(0_0_0/0.25)] md:px-8">
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
