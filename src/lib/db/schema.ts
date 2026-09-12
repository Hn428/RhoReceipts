/**
 * Database schema — the raw ledger layer.
 *
 * Naming convention: `rho_*` tables are a faithful mirror of what the Rho API
 * returned. They are the evidence base. Everything derived (classifications,
 * counterparty groupings, metric snapshots) lives in unprefixed tables added in
 * later phases, and must be reproducible from these rows alone. If a metric
 * cannot be rebuilt from `rho_*` by deleting every derived table and recomputing,
 * the traceability claim is broken.
 *
 * Two deliberate choices worth knowing about:
 *
 * 1. Enum-ish columns are `text`, not Postgres enums. Rho can add transaction
 *    types without it being a breaking change on their side; a Postgres enum
 *    would turn that into a failed ingest. We validate in application code and
 *    store whatever arrives.
 *
 * 2. Money is `bigint` in minor units. No numeric, no float, no exceptions.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  RhoAccount,
  RhoInvoice,
  RhoInvoicingCustomer,
  RhoTransaction,
} from "@/lib/rho/types";

/** Money in minor units. Signed: positive is into the account. */
const minorUnits = (name: string) => bigint(name, { mode: "number" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/**
 * A connected Rho credential. The product supports several per founder
 * ("connect one or more Rho accounts"), so every ledger row is scoped to one.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The founder who connected this account. Every ledger row hangs off a
     * connection, so this single column is what scopes the whole dataset to a
     * user — queries that forget it leak one company's bank history to another.
     */
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Encrypted at rest, bound to this connection's id. Never the raw token. */
    tokenCiphertext: text("token_ciphertext"),
    tokenRef: text("token_ref"),
    baseUrl: text("base_url").notNull(),
    status: text("status").notNull().default("active"),
    /**
     * High-water mark for incremental sync: the newest `initiated_at` seen.
     * Sync re-reads a window behind this because pending rows mutate.
     */
    syncedThrough: timestamp("synced_through", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("connections_owner_label_idx").on(t.ownerId, t.label),
    index("connections_owner_idx").on(t.ownerId),
  ],
);

export const rhoAccounts = pgTable(
  "rho_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    rhoAccountId: text("rho_account_id").notNull(),
    accountType: text("account_type").notNull(),
    accountName: text("account_name"),
    accountNumberLast4: text("account_number_last_4"),
    routingNumberLast4: text("routing_number_last_4"),
    /** Latest observed balance. History lives in accountBalanceSnapshots. */
    balanceMinor: minorUnits("balance_minor").notNull(),
    currency: text("currency").notNull(),
    balanceObservedAt: timestamp("balance_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: jsonb("payload").$type<RhoAccount>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rho_accounts_natural_key")
      .on(t.connectionId, t.rhoAccountId),
  ],
);

/**
 * Balances over time. Runway needs cash on hand at a point in the past, and a
 * balance is only ever reported as "now" — so we record each observation.
 */
export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => rhoAccounts.id, { onDelete: "cascade" }),
    balanceMinor: minorUnits("balance_minor").notNull(),
    currency: text("currency").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("balance_snapshots_account_idx").on(t.accountId, t.observedAt)],
);

/**
 * Current state of every transaction we have seen.
 *
 * Natural key is (connection, rho id, account id): the API documents that
 * `id` is "stable across re-fetches, not guaranteed unique per row", so the
 * account is included to stay correct if one id ever spans two ledger entries.
 */
export const rhoTransactions = pgTable(
  "rho_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    rhoTransactionId: text("rho_transaction_id").notNull(),
    /** Shared by every leg of one movement — how transfer pairs are detected. */
    rhoMoneyMovementId: text("rho_money_movement_id").notNull(),
    rhoAccountId: text("rho_account_id").notNull(),
    accountType: text("account_type").notNull(),
    accountName: text("account_name"),
    transactionType: text("transaction_type").notNull(),
    status: text("status").notNull(),
    amountMinor: minorUnits("amount_minor").notNull(),
    currency: text("currency").notNull(),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }).notNull(),
    /** Null while pending. A row is only cash-affecting once this is set. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    counterpartyName: text("counterparty_name").notNull(),
    counterpartyLogoUrl: text("counterparty_logo_url"),
    memo: text("memo"),
    note: text("note"),
    userId: text("user_id"),
    userFullName: text("user_full_name"),
    cardId: text("card_id"),
    cardName: text("card_name"),
    payload: jsonb("payload").$type<RhoTransaction>().notNull(),
    /** sha256 of the canonical payload; drives change detection. */
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rho_transactions_natural_key").on(
      t.connectionId,
      t.rhoTransactionId,
      t.rhoAccountId,
    ),
    index("rho_transactions_posted_idx").on(t.connectionId, t.postedAt),
    index("rho_transactions_initiated_idx").on(t.connectionId, t.initiatedAt),
    index("rho_transactions_movement_idx").on(t.rhoMoneyMovementId),
    index("rho_transactions_counterparty_idx").on(t.counterpartyName),
    index("rho_transactions_status_idx").on(t.status),
  ],
);

/**
 * Append-only history. Transactions mutate in the real world — a row goes
 * pending -> settled, `posted_at` fills in, an amount is adjusted. We never
 * overwrite that silently: each distinct payload we observe is recorded, so
 * "this metric changed because that payment settled on the 3rd" is answerable.
 */
export const rhoTransactionVersions = pgTable(
  "rho_transaction_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => rhoTransactions.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id"),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    amountMinor: minorUnits("amount_minor").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    payload: jsonb("payload").$type<RhoTransaction>().notNull(),
    contentHash: text("content_hash").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rho_transaction_versions_unique").on(
      t.transactionId,
      t.version,
    ),
    index("rho_transaction_versions_txn_idx").on(t.transactionId),
  ],
);

export const rhoCustomers = pgTable(
  "rho_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    rhoCustomerId: text("rho_customer_id").notNull(),
    legalName: text("legal_name").notNull(),
    email: text("email"),
    /** Derived from the billing email; the seed for Tavily verification. */
    emailDomain: text("email_domain"),
    totalRevenueMinor: minorUnits("total_revenue_minor"),
    currency: text("currency"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    payload: jsonb("payload").$type<RhoInvoicingCustomer>().notNull(),
    contentHash: text("content_hash").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rho_customers_natural_key").on(t.connectionId, t.rhoCustomerId),
  ],
);

export const rhoInvoices = pgTable(
  "rho_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    rhoInvoiceId: text("rho_invoice_id").notNull(),
    invoiceNumber: text("invoice_number"),
    status: text("status").notNull(),
    rhoCustomerId: text("rho_customer_id").notNull(),
    totalMinor: minorUnits("total_minor").notNull(),
    currency: text("currency").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    payload: jsonb("payload").$type<RhoInvoice>().notNull(),
    contentHash: text("content_hash").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rho_invoices_natural_key").on(t.connectionId, t.rhoInvoiceId),
    index("rho_invoices_customer_idx").on(t.connectionId, t.rhoCustomerId),
  ],
);

/**
 * The join that makes attribution exact.
 *
 * `rhoTransactionId` points at the bank row that settled the invoice, and the
 * invoice names the customer. Where this exists there is no guessing; where it
 * is absent, classification has to earn the answer. Phase 4 must show the
 * difference rather than blend them.
 */
export const rhoInvoicePayments = pgTable(
  "rho_invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => rhoInvoices.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    paymentType: text("payment_type").notNull(),
    externalMethod: text("external_method"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    rhoTransactionId: text("rho_transaction_id"),
    ...timestamps,
  },
  (t) => [
    index("rho_invoice_payments_txn_idx").on(
      t.connectionId,
      t.rhoTransactionId,
    ),
    uniqueIndex("rho_invoice_payments_unique").on(
      t.invoiceId,
      t.rhoTransactionId,
      t.paidAt,
    ),
  ],
);

/** One row per sync attempt — the operational audit trail. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    trigger: text("trigger").notNull().default("manual"),
    /** Lower bound actually requested, after the pending-overlap rewind. */
    windowStart: timestamp("window_start", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error"),
  },
  (t) => [index("sync_runs_connection_idx").on(t.connectionId, t.startedAt)],
);

export type Connection = typeof connections.$inferSelect;
export type RhoTransactionRow = typeof rhoTransactions.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;

// ---------------------------------------------------------------------------
// Auth.js tables.
//
// Shape is dictated by @auth/drizzle-adapter, not by us — keep the column names
// as the adapter expects them. A founder's identity lives here; their connected
// Rho credentials live in `connections` above, deliberately separate so that
// deleting an account is a different operation from revoking a bank connection.
// ---------------------------------------------------------------------------

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
});

export const authAccounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    uniqueIndex("account_provider_key").on(t.provider, t.providerAccountId),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("verification_token_key").on(t.identifier, t.token)],
);

// ---------------------------------------------------------------------------
// Receipts.
//
// A receipt is a snapshot, frozen when it is issued. The page an investor opens
// renders only from `snapshot`, never from live ledger rows, so the figures
// they audit cannot shift underneath them when a pending payment settles
// tomorrow. Issuing a new receipt is how numbers get updated — deliberately.
// ---------------------------------------------------------------------------

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The share link. 72 bits of randomness — anyone holding the URL can view
     * the receipt, so unguessability is the access control.
     */
    slug: text("slug").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    /** Bumped when classification or metric rules change meaningfully. */
    engineVersion: text("engine_version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("receipts_slug_idx").on(t.slug),
    index("receipts_connection_idx").on(t.connectionId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Monthly investor receipts.
//
// Idempotency lives in the schema, not in application code: one report per
// connection per month, one delivery per recipient per report. A cron that
// runs twice, or a founder who presses "Send now" after the cron already ran,
// cannot send anyone the same receipt twice.
// ---------------------------------------------------------------------------

/** Investors a founder has chosen to send monthly receipts to. */
export const investorRecipients = pgTable(
  "investor_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("investor_recipients_unique").on(t.connectionId, t.email)],
);

export const monthlyReports = pgTable(
  "monthly_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The report's own share link. Same unguessability rule as receipts. */
    slug: text("slug").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "2026-08" — the month reported on. */
    periodKey: text("period_key").notNull(),
    companyName: text("company_name").notNull(),
    /** The full receipt issued alongside, for drill-down. */
    receiptSlug: text("receipt_slug").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    engineVersion: text("engine_version").notNull(),
    trigger: text("trigger").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("monthly_reports_slug_idx").on(t.slug),
    uniqueIndex("monthly_reports_period_idx").on(t.connectionId, t.periodKey),
  ],
);

export const reportDeliveries = pgTable(
  "report_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => monthlyReports.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    status: text("status").notNull(),
    /** "console" in development; a provider name once real mail is wired. */
    transport: text("transport").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("report_deliveries_unique").on(t.reportId, t.email)],
);
