import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { money } from "@/lib/money";
import { companyBySlug, mockCompanies } from "@/lib/rho/mock/store";
import type { RhoTransaction } from "@/lib/rho/types";
import { day, signed, whole } from "@/lib/receipts/format";

type Props = {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ view?: string; account?: string; all?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company } = await params;
  const found = companyBySlug(company);
  return {
    title: found ? `${found.meta.short_name} · Mock Rho` : "Mock Rho",
    robots: { index: false, follow: false },
  };
}

const TYPE_LABELS: Record<string, string> = {
  ach_credit: "ACH in",
  ach_debit: "ACH out",
  ach_return: "ACH return",
  wire_in: "Wire in",
  wire_out: "Wire out",
  international_wire_out: "Intl wire out",
  international_wire_fee: "Wire fee",
  card_debit: "Card",
  card_refund: "Card refund",
  credit_repayment: "Card payment",
  internal_transfer: "Transfer",
  treasury_deposit: "Treasury deposit",
  savings_interest: "Interest",
  treasury_interest: "Treasury yield",
  rewards_accrual: "Rewards",
  check_deposit: "Check deposit",
};

const VIEWS = [
  { key: "all", label: "All activity" },
  { key: "in", label: "Money in" },
  { key: "out", label: "Money out" },
] as const;

const PAGE = 60;

export default async function MockRhoDashboard({ params, searchParams }: Props) {
  const { company: slug } = await params;
  const { view = "all", account, all } = await searchParams;
  const company = companyBySlug(slug);
  if (!company) notFound();

  const byNewest = (a: RhoTransaction, b: RhoTransaction) =>
    Date.parse(b.initiated_at) - Date.parse(a.initiated_at);

  const rows = company.transactions
    .filter((t) => !account || t.account_id === account)
    .filter((t) =>
      view === "in" ? t.amount.amount > 0 : view === "out" ? t.amount.amount < 0 : true,
    )
    .sort(byNewest);
  const shown = all ? rows : rows.slice(0, PAGE);

  const openInvoices = company.invoices.filter((i) => i.status !== "paid");
  const recentInvoices = [...company.invoices]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 8);
  const customerName = new Map(company.customers.map((c) => [c.id, c.legal_name]));

  const href = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { view, account, ...next };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "all")) query.set(k, v);
    const qs = query.toString();
    return `/mock-rho/${slug}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="bank flex min-h-full flex-1 flex-col">
      {/* ------------------------------------------------ simulation banner */}
      <div className="bank-banner border-b border-[var(--bank-warn)]/30 px-4 py-2 text-center font-mono text-[0.72rem] tracking-[0.04em] text-[var(--bank-warn)]">
        <strong className="font-semibold">MOCK RHO BANKING ENVIRONMENT</strong> · Simulated
        ledger for the Rho Receipts demo · Not affiliated with or operated by Rho
      </div>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--bank-line)] bg-[var(--bank-surface)] px-4 py-6 lg:flex">
          <div className="flex items-center gap-3 border-b border-[var(--bank-line)] pb-5"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--bank-ink)] font-semibold text-white">{company.meta.short_name[0]}</span><div><p className="text-sm font-semibold">{company.meta.short_name}</p><p className="text-xs text-[var(--bank-faint)]">Business account</p></div></div>
          <nav aria-label="Mock bank" className="mt-5 flex flex-col gap-1 text-sm">
            {[["Overview","▦"],["Accounts","◫"],["Transactions","↕"],["Transfers","⇄"],["Payments","◎"],["Team","◻"]].map(([label, icon], index) => <span key={label} className={`rounded-md px-3 py-2 ${index === 0 ? "bg-[var(--bank-accent-wash)] font-medium text-[var(--bank-accent)]" : "text-[var(--bank-muted)]"}`}><span className="mr-2 inline-block w-4">{icon}</span>{label}</span>)}
          </nav>
          <div className="mt-auto rounded-lg border border-[var(--bank-line)] bg-[var(--bank-bg)] p-4"><p className="text-xs font-semibold">Rho Receipts</p><p className="mt-1 text-xs leading-5 text-[var(--bank-muted)]">Generate a private verified receipt.</p><Link href={`/enroll?company=${slug}`} className="mt-3 block rounded-md bg-[var(--bank-accent)] px-3 py-2 text-center text-xs font-medium text-white">Generate receipt →</Link></div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">

      <header className="border-b border-[var(--bank-line)] bg-[var(--bank-surface)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight">Mock Rho</span>
            <nav aria-label="Companies" className="flex gap-1">
              {mockCompanies.map((c) => (
                <Link
                  key={c.meta.slug}
                  href={`/mock-rho/${c.meta.slug}`}
                  aria-current={c.meta.slug === slug ? "page" : undefined}
                  className="rounded-md px-3 py-1.5 text-sm text-[var(--bank-muted)] hover:bg-[var(--bank-bg)] aria-[current=page]:bg-[var(--bank-accent-wash)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--bank-accent)]"
                >
                  {c.meta.short_name}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="cursor-default select-none px-3 py-2 text-sm text-[var(--bank-muted)]">
              Rho Receipts
            </span>
            <Link
              href={`/enroll?company=${slug}`}
              className="rounded-md bg-[var(--bank-accent)] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-[var(--bank-bg)]"
            >
              Enroll →
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{company.meta.company}</h1>
          <p className="text-sm text-[var(--bank-muted)]">
            Business banking · {company.accounts.length} accounts · data as of{" "}
            {/* The anchor is a calendar date; format it in UTC so no timezone shifts it. */}
            {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(company.meta.anchor))}
          </p>
        </div>

        {/* ---------------------------------------------------- accounts */}
        <section aria-labelledby="accounts" className="flex flex-col gap-3">
          <h2 id="accounts" className="text-sm font-semibold">
            Accounts
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {company.accounts.map((a) => (
              <Link
                key={a.id}
                href={href({ account: account === a.id ? undefined : a.id, all: undefined })}
                aria-pressed={account === a.id}
                className="flex flex-col gap-2 rounded-lg border border-[var(--bank-line)] bg-[var(--bank-surface)] p-4 hover:border-[var(--bank-accent)] aria-[pressed=true]:border-[var(--bank-accent)] aria-[pressed=true]:ring-1 aria-[pressed=true]:ring-[var(--bank-accent)]"
              >
                <span className="text-xs text-[var(--bank-muted)]">
                  {a.account_name?.split(" — ")[1] ?? a.account_type} ····{a.account_number_last_4}
                </span>
                <span className="figures text-lg">{whole(money(a.balance.amount, a.balance.currency))}</span>
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          {/* ---------------------------------------------- transactions */}
          <section aria-labelledby="activity" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="activity" className="text-sm font-semibold">
                Transactions
                <span className="ml-2 font-normal text-[var(--bank-faint)]">{rows.length.toLocaleString("en-US")}</span>
              </h2>
              <div className="flex gap-1 rounded-md border border-[var(--bank-line)] bg-[var(--bank-surface)] p-0.5">
                {VIEWS.map((v) => (
                  <Link
                    key={v.key}
                    href={href({ view: v.key, all: undefined })}
                    aria-current={view === v.key ? "true" : undefined}
                    className="rounded px-2.5 py-1 text-xs text-[var(--bank-muted)] aria-[current=true]:bg-[var(--bank-accent-wash)] aria-[current=true]:text-[var(--bank-accent)]"
                  >
                    {v.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--bank-line)] bg-[var(--bank-surface)]">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--bank-line)] text-left text-xs text-[var(--bank-muted)]">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Description</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={`${t.id}-${t.account_id}`} className="border-b border-[var(--bank-line)] last:border-b-0">
                      <td className="figures whitespace-nowrap px-4 py-2.5 text-xs text-[var(--bank-muted)]">
                        {day(t.initiated_at)}
                      </td>
                      <td className="max-w-[18rem] px-4 py-2.5">
                        <div className="truncate">{t.counterparty_name}</div>
                        <div className="truncate text-xs text-[var(--bank-faint)]">
                          {t.account_name.split(" — ")[1]} · {t.memo}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--bank-muted)]">
                        {TYPE_LABELS[t.transaction_type] ?? t.transaction_type.replace(/_/g, " ")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        <span className={t.status === "settled" ? "text-[var(--bank-muted)]" : "text-[var(--bank-warn)]"}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td
                        className={`figures whitespace-nowrap px-4 py-2.5 text-right ${t.amount.amount > 0 ? "text-[var(--bank-in)]" : ""}`}
                      >
                        {signed(money(t.amount.amount, t.amount.currency))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!all && rows.length > PAGE && (
              <Link href={href({ all: "1" })} className="self-start text-sm text-[var(--bank-accent)] hover:underline">
                Show all {rows.length.toLocaleString("en-US")} transactions
              </Link>
            )}
          </section>

          {/* --------------------------------------------------- invoices */}
          <aside aria-labelledby="invoices" className="flex flex-col gap-3">
            <h2 id="invoices" className="text-sm font-semibold">
              Invoices
              <span className="ml-2 font-normal text-[var(--bank-faint)]">
                {company.invoices.length} sent · {openInvoices.length} open
              </span>
            </h2>
            <ul className="flex flex-col rounded-lg border border-[var(--bank-line)] bg-[var(--bank-surface)]">
              {[...openInvoices, ...recentInvoices.filter((i) => i.status === "paid")].slice(0, 8).map((inv) => (
                <li key={inv.id} className="flex flex-col gap-1 border-b border-[var(--bank-line)] px-4 py-3 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm">{customerName.get(inv.customer.id)}</span>
                    <span className="figures whitespace-nowrap text-sm">{whole(money(inv.total.amount, inv.total.currency))}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-xs text-[var(--bank-faint)]">
                    <span className="figures">{inv.invoice_number}</span>
                    <span
                      className={
                        inv.status === "paid"
                          ? "text-[var(--bank-in)]"
                          : "rounded bg-[var(--bank-warn-wash)] px-1.5 font-medium text-[var(--bank-warn)]"
                      }
                    >
                      {inv.status === "paid" ? "Paid" : `${inv.status[0].toUpperCase()}${inv.status.slice(1)} · due ${day(inv.due_date ?? inv.date)}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
        </div>
      </div>
    </div>
  );
}
