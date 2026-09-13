import { describe, expect, it } from "vitest";

import acmeAccounts from "@/lib/rho/fixtures/acme-ai/accounts.json";
import acmeCustomers from "@/lib/rho/fixtures/acme-ai/customers.json";
import acmeInvoices from "@/lib/rho/fixtures/acme-ai/invoices.json";
import acmeMeta from "@/lib/rho/fixtures/acme-ai/meta.json";
import acmeTransactions from "@/lib/rho/fixtures/acme-ai/transactions.json";
import nsAccounts from "@/lib/rho/fixtures/northstar-labs/accounts.json";
import nsCustomers from "@/lib/rho/fixtures/northstar-labs/customers.json";
import nsInvoices from "@/lib/rho/fixtures/northstar-labs/invoices.json";
import nsMeta from "@/lib/rho/fixtures/northstar-labs/meta.json";
import nsTransactions from "@/lib/rho/fixtures/northstar-labs/transactions.json";
import { classifyLedger } from "@/lib/classify";
import { money } from "@/lib/money";
import type {
  RhoAccount,
  RhoInvoice,
  RhoInvoicingCustomer,
  RhoTransaction,
} from "@/lib/rho/types";

import { buildMonthlyReport, cashBalanceAt } from "./monthly";

const CASH_TYPES = ["checking", "savings", "investment"];

function reportFor(fixture: {
  accounts: unknown;
  transactions: unknown;
  invoices: unknown;
  customers: unknown;
  meta: { anchor: string; opening_balances: Record<string, number> };
}) {
  const accounts = fixture.accounts as RhoAccount[];
  const transactions = fixture.transactions as RhoTransaction[];
  const invoices = fixture.invoices as RhoInvoice[];
  const customers = fixture.customers as RhoInvoicingCustomer[];
  const cashAccounts = accounts.filter((a) => CASH_TYPES.includes(a.account_type));
  const { classifications } = classifyLedger({ accounts, transactions, invoices, customers });
  const input = {
    classifications,
    invoices,
    customers,
    cashBalances: cashAccounts.map((a) => money(a.balance.amount, a.balance.currency)),
    cashAccountIds: cashAccounts.map((a) => a.id),
    asOf: new Date(fixture.meta.anchor),
    currency: "USD",
  };
  return { report: buildMonthlyReport(input), input, transactions, cashAccounts, meta: fixture.meta };
}

const acme = reportFor({
  accounts: acmeAccounts,
  transactions: acmeTransactions,
  invoices: acmeInvoices,
  customers: acmeCustomers,
  meta: acmeMeta,
});
const northstar = reportFor({
  accounts: nsAccounts,
  transactions: nsTransactions,
  invoices: nsInvoices,
  customers: nsCustomers,
  meta: nsMeta,
});

describe("periods", () => {
  it("reports on the last complete month against the one before", () => {
    expect(acme.report.period).toEqual({ key: "2026-08", label: "August 2026" });
    expect(acme.report.previousPeriod).toEqual({ key: "2026-07", label: "July 2026" });
  });
});

describe("month-over-month figures", () => {
  it("compares MRR with last month", () => {
    expect(acme.report.mrr.current.minor).toBe(5_325_100);
    expect(acme.report.mrr.previous?.minor).toBe(5_251_100);
    expect(acme.report.mrr.change).toBe(0.014);
  });

  it("uses exactly the linked receipt's figures for the current month", () => {
    // The email links to the receipt; the two must never disagree.
    const { report } = acme;
    expect(report.mrr.current).toEqual(report.receipt.mrr.value);
    expect(report.netBurn.current).toEqual(report.receipt.netBurn.value);
    expect(report.runwayMonths.current).toBe(report.receipt.runwayMonths.value);
    expect(report.cash.current).toEqual(report.receipt.cashOnHand.value);
  });

  it("computes a previous runway from last month's closing cash", () => {
    expect(acme.report.runwayMonths.previous).not.toBeNull();
    expect(acme.report.runwayMonths.previous).not.toBe(acme.report.runwayMonths.current);
  });
});

describe("reconstructed cash", () => {
  // Two independent paths to the same number: backwards from today's balances
  // through the engine, and forwards from opening balances through raw rows.
  for (const [name, fixture] of [["Acme AI", acme], ["Northstar Labs", northstar]] as const) {
    it(`agrees with opening balances plus the ledger — ${name}`, () => {
      const instant = fixture.report.receipt.reportingPeriod.start;
      const cashIds = new Set(fixture.cashAccounts.map((a) => a.id));
      const opening = fixture.cashAccounts.reduce(
        (s, a) => s + (fixture.meta.opening_balances[a.id] ?? 0),
        0,
      );
      const before = fixture.transactions
        .filter(
          (t) =>
            t.status === "settled" &&
            cashIds.has(t.account_id) &&
            t.posted_at !== null &&
            Date.parse(t.posted_at) < instant.getTime(),
        )
        .reduce((s, t) => s + t.amount.amount, 0);

      expect(cashBalanceAt(fixture.input, instant).minor).toBe(opening + before);
      expect(fixture.report.cash.previousMonthEnd.minor).toBe(opening + before);
    });
  }
});

describe("customers", () => {
  it("names the customer who first paid this month", () => {
    expect(acme.report.newCustomers.map((c) => c.customerName)).toEqual(["Kittiwake Systems"]);
  });

  it("names a customer who paid last month but not this one", () => {
    expect(acme.report.missedCustomers.map((c) => c.customerName)).toEqual(["Driftwood Logistics"]);
    expect(acme.report.missedCustomers[0].previousAmount.minor).toBe(390_000);
  });

  it("reports no new customers when none started", () => {
    expect(northstar.report.newCustomers).toEqual([]);
  });
});

describe("flags", () => {
  const kinds = (flags: typeof acme.report.flags) => flags.map((f) => f.kind).sort();

  it("flags the overdue invoice in calendar days", () => {
    const overdue = acme.report.flags.find((f) => f.kind === "overdue_invoice");
    expect(overdue).toMatchObject({
      customerName: "Driftwood Logistics",
      invoiceNumber: "AC-1057",
      daysOverdue: 17, // due 25 August; the anchor falls on 11 September in New York
    });
  });

  it("flags concentration above the threshold", () => {
    const flag = acme.report.flags.find((f) => f.kind === "concentration");
    expect(flag).toMatchObject({ customerName: "Tessellate Health, Inc.", share: 0.316 });
  });

  it("flags revenue without an invoice", () => {
    const flag = acme.report.flags.find((f) => f.kind === "needs_review");
    expect(flag).toMatchObject({ customerName: "Greyfield Trading LLC" });
  });

  it("raises exactly the planted flags for each company", () => {
    expect(kinds(acme.report.flags)).toEqual(["concentration", "needs_review", "overdue_invoice"]);
    expect(kinds(northstar.report.flags)).toEqual(["needs_review", "related_party"]);
  });
});
