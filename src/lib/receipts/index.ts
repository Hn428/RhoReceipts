/**
 * Issuing and loading receipts.
 *
 * Issuing runs the full pipeline — ledger rows, classification, metrics — and
 * freezes the result as a JSON snapshot. The public page renders only from
 * that snapshot. It performs no arithmetic and reads no live ledger rows, so
 * what an investor audits is exactly what was issued.
 */

import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { classifyLedger, type Attribution, type CashClass } from "@/lib/classify";
import { getDb } from "@/lib/db";
import {
  receipts,
  rhoAccounts,
  rhoCustomers,
  rhoInvoices,
  rhoTransactions,
} from "@/lib/db/schema";
import { getOwnedConnection } from "@/lib/ingest/sync";
import {
  buildReceipt,
  type CustomerRevenue,
  type ExcludedGroup,
  type MetricValue,
  type RelatedParty,
} from "@/lib/metrics";
import { money, type Money } from "@/lib/money";
import { formatPeriod, parsePeriodKey } from "@/lib/period";

/** Bump when classification or metric rules change in a way that moves numbers. */
export const ENGINE_VERSION = "2026.09.2";

const CASH_ACCOUNT_TYPES = new Set(["checking", "savings", "investment"]);

export interface SnapshotTransaction {
  id: string;
  postedAt: string | null;
  initiatedAt: string;
  counterparty: string;
  memo: string | null;
  accountName: string;
  type: string;
  status: string;
  amount: Money;
  cashClass: CashClass;
  attribution: Attribution;
  customerName: string | null;
  invoiceNumber: string | null;
  relatedParty: boolean;
  coversMonths: number;
  reason: string;
}

export interface ReceiptSnapshot {
  version: 1;
  companyName: string;
  /** Issued from the synthetic fixture company rather than a real bank. */
  isDemo: boolean;
  asOf: string;
  engineVersion: string;
  reportingPeriod: { key: string; label: string };
  previousPeriod: { key: string; label: string; revenue: Money } | null;
  source: {
    accounts: {
      name: string;
      type: string;
      last4: string | null;
      balance: Money;
      isCash: boolean;
    }[];
    transactionCount: number;
    invoiceCount: number;
    customerCount: number;
  };
  metrics: {
    mrr: MetricValue<Money>;
    arr: MetricValue<Money>;
    netBurn: MetricValue<Money>;
    cashOnHand: MetricValue<Money>;
    runwayMonths: MetricValue<number | null>;
    growthRate: MetricValue<number | null>;
    concentration: MetricValue<{
      topCustomerShare: number | null;
      topCustomerName: string | null;
      topFiveShare: number | null;
      customers: (CustomerRevenue & { share: number | null })[];
    }>;
  };
  /** Absent on receipts issued before engine 2026.09.2. */
  prepaymentsInPeriod?: MetricValue<Money>;
  operatingIn: Money;
  operatingOut: Money;
  averageMonthlyBurn: Money;
  trailingBurn: {
    periodKey: string;
    label: string;
    netBurn: Money;
    transactionIds: string[];
  }[];
  /** Revenue for the reporting month, broken down by customer. */
  mrrCustomers: CustomerRevenue[];
  /** Up to twelve months of recognised revenue, oldest first. */
  revenueHistory: { periodKey: string; label: string; revenue: Money }[];
  excluded: ExcludedGroup[];
  relatedParties: RelatedParty[];
  /** Every transaction referenced anywhere above, keyed by Rho id. */
  transactions: Record<string, SnapshotTransaction>;
}

export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptError";
  }
}

const label = (key: string) => formatPeriod(parsePeriodKey(key));

/** "Northstar Labs (mock)" → "Northstar Labs". */
const companyNameFrom = (connectionLabel: string) =>
  connectionLabel.replace(/\s*\(mock\)\s*$/i, "").trim();

export async function issueReceipt(options: {
  connectionId: string;
  ownerId: string;
  asOf?: Date;
}): Promise<{ slug: string }> {
  const db = getDb();
  const connection = await getOwnedConnection(
    options.connectionId,
    options.ownerId,
    db,
  );
  if (!connection) throw new ReceiptError("Connection not found.");

  const [accountRows, transactionRows, invoiceRows, customerRows] =
    await Promise.all([
      db.select().from(rhoAccounts).where(eq(rhoAccounts.connectionId, connection.id)),
      db
        .select()
        .from(rhoTransactions)
        .where(eq(rhoTransactions.connectionId, connection.id)),
      db.select().from(rhoInvoices).where(eq(rhoInvoices.connectionId, connection.id)),
      db.select().from(rhoCustomers).where(eq(rhoCustomers.connectionId, connection.id)),
    ]);

  if (transactionRows.length === 0) {
    throw new ReceiptError(
      "No transactions have been imported for this account yet.",
    );
  }

  // Stored payloads are the Rho wire objects verbatim, so the pipeline runs
  // on exactly what the bank returned.
  const accounts = accountRows.map((row) => row.payload);
  const { classifications, byTransactionId } = classifyLedger({
    accounts,
    transactions: transactionRows.map((row) => row.payload),
    invoices: invoiceRows.map((row) => row.payload),
    customers: customerRows.map((row) => row.payload),
  });

  const currency = accounts[0]?.balance.currency ?? "USD";
  const asOf = options.asOf ?? new Date();
  const cashAccounts = accounts.filter((a) => CASH_ACCOUNT_TYPES.has(a.account_type));

  const receipt = buildReceipt({
    classifications,
    cashBalances: cashAccounts.map((a) => money(a.balance.amount, a.balance.currency)),
    asOf,
    currency,
  });

  const reportingMonth = receipt.monthlyRevenue.find(
    (m) => m.periodKey === receipt.reportingPeriod.key,
  );
  const previousIndex = receipt.monthlyRevenue.findIndex(
    (m) => m.periodKey === receipt.reportingPeriod.key,
  );
  const previousMonth =
    previousIndex > 0 ? receipt.monthlyRevenue[previousIndex - 1] : null;

  const payloadById = new Map(transactionRows.map((row) => [row.payload.id, row.payload]));
  const transactions: Record<string, SnapshotTransaction> = {};
  for (const item of classifications) {
    const raw = payloadById.get(item.rhoTransactionId);
    if (!raw) continue;
    transactions[item.rhoTransactionId] = {
      id: raw.id,
      postedAt: raw.posted_at,
      initiatedAt: raw.initiated_at,
      counterparty: raw.counterparty_name,
      memo: raw.memo,
      accountName: raw.account_name,
      type: raw.transaction_type,
      status: raw.status,
      amount: item.amount,
      cashClass: item.cashClass,
      attribution: item.attribution,
      customerName: item.customerName,
      invoiceNumber: item.invoiceNumber,
      relatedParty: item.relatedParty,
      coversMonths: item.coversMonths,
      reason: byTransactionId.get(item.rhoTransactionId)?.reason ?? item.reason,
    };
  }

  const companyName = companyNameFrom(connection.label);

  const snapshot: ReceiptSnapshot = {
    version: 1,
    companyName,
    isDemo: connection.baseUrl.includes("/api/mock/rho/"),
    asOf: asOf.toISOString(),
    engineVersion: ENGINE_VERSION,
    reportingPeriod: {
      key: receipt.reportingPeriod.key,
      label: label(receipt.reportingPeriod.key),
    },
    previousPeriod: previousMonth
      ? {
          key: previousMonth.periodKey,
          label: label(previousMonth.periodKey),
          revenue: previousMonth.revenue,
        }
      : null,
    source: {
      accounts: accounts.map((a) => ({
        name: a.account_name ?? a.account_type,
        type: a.account_type,
        last4: a.account_number_last_4 ?? null,
        balance: money(a.balance.amount, a.balance.currency),
        isCash: CASH_ACCOUNT_TYPES.has(a.account_type),
      })),
      transactionCount: transactionRows.length,
      invoiceCount: invoiceRows.length,
      customerCount: customerRows.length,
    },
    metrics: {
      mrr: receipt.mrr,
      arr: receipt.arr,
      netBurn: receipt.netBurn,
      cashOnHand: receipt.cashOnHand,
      runwayMonths: receipt.runwayMonths,
      growthRate: receipt.growthRate,
      concentration: receipt.concentration,
    },
    prepaymentsInPeriod: receipt.prepaymentsInPeriod,
    operatingIn: receipt.operatingIn,
    operatingOut: receipt.operatingOut,
    averageMonthlyBurn: receipt.averageMonthlyBurn,
    trailingBurn: receipt.trailingBurn.map((m) => ({ ...m, label: label(m.periodKey) })),
    mrrCustomers: reportingMonth?.byCustomer ?? [],
    revenueHistory: receipt.monthlyRevenue.slice(-12).map((m) => ({
      periodKey: m.periodKey,
      label: label(m.periodKey),
      revenue: m.revenue,
    })),
    excluded: receipt.excluded,
    relatedParties: receipt.relatedParties,
    transactions,
  };

  const slug = randomBytes(9).toString("base64url");
  await db.insert(receipts).values({
    slug,
    ownerId: options.ownerId,
    connectionId: connection.id,
    companyName,
    asOf,
    engineVersion: ENGINE_VERSION,
    snapshot,
  });

  return { slug };
}

export async function getReceiptBySlug(slug: string) {
  // Slugs are 12 base64url characters; reject anything else before querying.
  if (!/^[A-Za-z0-9_-]{12}$/.test(slug)) return null;
  const [row] = await getDb()
    .select()
    .from(receipts)
    .where(eq(receipts.slug, slug))
    .limit(1);
  if (!row) return null;
  return { ...row, snapshot: row.snapshot as ReceiptSnapshot };
}

export async function latestReceiptFor(connectionId: string, ownerId: string) {
  const [row] = await getDb()
    .select({ slug: receipts.slug, asOf: receipts.asOf, createdAt: receipts.createdAt })
    .from(receipts)
    .where(and(eq(receipts.connectionId, connectionId), eq(receipts.ownerId, ownerId)))
    .orderBy(desc(receipts.createdAt))
    .limit(1);
  return row ?? null;
}
