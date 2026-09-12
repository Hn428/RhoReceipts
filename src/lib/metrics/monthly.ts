/**
 * The monthly investor receipt: this month against last month.
 *
 * Pure and deterministic, like the rest of the engine. The report's "current"
 * figures are exactly those of the receipt issued alongside it, so an investor
 * who clicks through from the email sees the same numbers. The "previous"
 * figures are last month's, computed with cash as it stood when that month
 * ended — reconstructed from the ledger, since a bank only reports balances
 * as of now.
 */

import type { Classification } from "@/lib/classify";
import {
  type Money,
  isZero,
  money,
  ratio,
  subtract,
  sum,
} from "@/lib/money";
import { calendarDaysBetween, formatPeriod } from "@/lib/period";
import type { RhoInvoice, RhoInvoicingCustomer } from "@/lib/rho/types";

import { buildReceipt, type CustomerRevenue, type Receipt } from "./index";

/** A single customer above this share of revenue is flagged. */
export const CONCENTRATION_FLAG_SHARE = 0.3;

export interface Change {
  current: Money;
  previous: Money | null;
  /** Relative change, rounded to a tenth of a percent. Null without a baseline. */
  change: number | null;
}

export type ReportFlag =
  | {
      kind: "overdue_invoice";
      customerName: string;
      invoiceNumber: string;
      amount: Money;
      dueAt: string;
      daysOverdue: number;
    }
  | { kind: "concentration"; customerName: string; share: number }
  | { kind: "needs_review"; customerName: string; amount: Money }
  | { kind: "related_party"; customerName: string; moneyIn: Money; moneyOut: Money };

export interface MonthlyReport {
  period: { key: string; label: string };
  previousPeriod: { key: string; label: string };
  mrr: Change;
  netBurn: Change;
  cash: { current: Money; previousMonthEnd: Money };
  runwayMonths: { current: number | null; previous: number | null };
  topCustomer: {
    current: { name: string | null; share: number | null };
    previous: { name: string | null; share: number | null };
  };
  /** Customers whose first revenue landed in this month. */
  newCustomers: CustomerRevenue[];
  /** Paid last month, but nothing this month. Not necessarily churn. */
  missedCustomers: (CustomerRevenue & { previousAmount: Money })[];
  flags: ReportFlag[];
  /** The full receipt the current figures come from. */
  receipt: Receipt;
}

export interface MonthlyReportInput {
  classifications: readonly Classification[];
  invoices: readonly RhoInvoice[];
  customers: readonly RhoInvoicingCustomer[];
  cashBalances: readonly Money[];
  cashAccountIds: readonly string[];
  asOf: Date;
  currency: string;
  timeZone?: string;
}

/**
 * Cash on hand at a past instant: today's balances minus every settled
 * movement on a cash account posted since. Transfers between cash accounts
 * cancel out on their own; financing and card repayments do not, as they
 * shouldn't.
 */
export function cashBalanceAt(
  input: Pick<MonthlyReportInput, "classifications" | "cashBalances" | "cashAccountIds" | "currency">,
  instant: Date,
): Money {
  const cashAccounts = new Set(input.cashAccountIds);
  const since = input.classifications.filter(
    (c) =>
      c.postedAt !== null &&
      c.postedAt.getTime() >= instant.getTime() &&
      cashAccounts.has(c.accountId),
  );
  return subtract(
    sum(input.cashBalances, input.currency),
    sum(since.map((c) => c.amount), input.currency),
  );
}

function relativeChange(current: Money, previous: Money | null): number | null {
  if (!previous || isZero(previous)) return null;
  return Math.round(ratio(subtract(current, previous), previous) * 1000) / 1000;
}

export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReport {
  const { classifications, asOf, currency, timeZone } = input;

  // Current: identical to the receipt issued with this report.
  const current = buildReceipt({
    classifications,
    cashBalances: input.cashBalances,
    asOf,
    currency,
    timeZone,
  });

  // Previous: the month before, as it looked when that month closed.
  const previousAsOf = current.reportingPeriod.start;
  const previousCash = cashBalanceAt(input, previousAsOf);
  const previous = buildReceipt({
    classifications,
    cashBalances: [previousCash],
    asOf: previousAsOf,
    currency,
    timeZone,
  });

  const history = current.monthlyRevenue;
  const currentMonth = history.find((m) => m.periodKey === current.reportingPeriod.key);
  const previousMonth = history.find((m) => m.periodKey === previous.reportingPeriod.key);

  // --- New and missed customers ------------------------------------------------
  const firstPaidPeriod = new Map<string, string>();
  for (const month of history) {
    for (const customer of month.byCustomer) {
      if (!customer.customerId || customer.amount.minor <= 0) continue;
      if (!firstPaidPeriod.has(customer.customerId)) {
        firstPaidPeriod.set(customer.customerId, month.periodKey);
      }
    }
  }

  const currentCustomers = currentMonth?.byCustomer ?? [];
  const newCustomers = currentCustomers.filter(
    (c) => c.customerId && firstPaidPeriod.get(c.customerId) === current.reportingPeriod.key,
  );

  const paidThisMonth = new Set(
    currentCustomers.filter((c) => c.amount.minor > 0).map((c) => c.customerId),
  );
  const missedCustomers = (previousMonth?.byCustomer ?? [])
    .filter((c) => c.customerId && c.amount.minor > 0 && !paidThisMonth.has(c.customerId))
    .map((c) => ({ ...c, amount: money(0, currency), previousAmount: c.amount }));

  // --- Flags -------------------------------------------------------------------
  const flags: ReportFlag[] = [];

  const customerName = new Map(input.customers.map((c) => [c.id, c.legal_name]));
  for (const invoice of input.invoices) {
    if (invoice.status === "paid" || invoice.status === "cancelled" || !invoice.due_date) continue;
    const daysOverdue = calendarDaysBetween(new Date(invoice.due_date), asOf, timeZone);
    if (daysOverdue <= 0) continue;
    flags.push({
      kind: "overdue_invoice",
      customerName: customerName.get(invoice.customer.id) ?? "Unknown customer",
      invoiceNumber: invoice.invoice_number,
      amount: money(invoice.total.amount, invoice.total.currency),
      dueAt: invoice.due_date,
      daysOverdue,
    });
  }

  const top = current.concentration.value;
  if (top.topCustomerShare !== null && top.topCustomerShare > CONCENTRATION_FLAG_SHARE && top.topCustomerName) {
    flags.push({ kind: "concentration", customerName: top.topCustomerName, share: top.topCustomerShare });
  }

  for (const c of currentCustomers) {
    if (c.attribution === "name_match") {
      flags.push({ kind: "needs_review", customerName: c.customerName, amount: c.amount });
    }
  }

  for (const party of current.relatedParties) {
    flags.push({
      kind: "related_party",
      customerName: party.customerName,
      moneyIn: party.moneyIn,
      moneyOut: party.moneyOut,
    });
  }

  return {
    period: { key: current.reportingPeriod.key, label: formatPeriod(current.reportingPeriod) },
    previousPeriod: { key: previous.reportingPeriod.key, label: formatPeriod(previous.reportingPeriod) },
    mrr: {
      current: current.mrr.value,
      previous: previous.mrr.value,
      change: relativeChange(current.mrr.value, previous.mrr.value),
    },
    netBurn: {
      current: current.netBurn.value,
      previous: previous.netBurn.value,
      change: relativeChange(current.netBurn.value, previous.netBurn.value),
    },
    cash: { current: current.cashOnHand.value, previousMonthEnd: previousCash },
    runwayMonths: { current: current.runwayMonths.value, previous: previous.runwayMonths.value },
    topCustomer: {
      current: { name: top.topCustomerName, share: top.topCustomerShare },
      previous: {
        name: previous.concentration.value.topCustomerName,
        share: previous.concentration.value.topCustomerShare,
      },
    },
    newCustomers,
    missedCustomers,
    flags,
    receipt: current,
  };
}
