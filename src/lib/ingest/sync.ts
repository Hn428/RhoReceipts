/**
 * Ingestion: Rho API -> raw ledger tables.
 *
 * Properties this is built to guarantee:
 *
 * - **Idempotent.** Running twice over the same data changes nothing. The second
 *   run reports every row as unchanged. This is the test that matters.
 * - **Non-destructive.** A transaction that mutates (pending -> settled) updates
 *   the current row *and* appends a version, so history is never overwritten.
 * - **Incremental, with an overlap window.** Syncing only rows newer than the
 *   last watermark would miss pending transactions that settle later. Pending
 *   rows keep their `initiated_at`, so we rewind the window by OVERLAP_DAYS and
 *   re-read. Re-reading is free precisely because the sync is idempotent.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb, type Database } from "@/lib/db";
import type { Connection } from "@/lib/db/schema";
import {
  accountBalanceSnapshots,
  connections,
  rhoAccounts,
  rhoCustomers,
  rhoInvoicePayments,
  rhoInvoices,
  rhoTransactionVersions,
  rhoTransactions,
  syncRuns,
  users,
} from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/envelope";
import { RhoClient } from "@/lib/rho/client";
import type { RhoTransaction } from "@/lib/rho/types";

import { contentHash } from "./hash";

/**
 * How far back to re-read on every incremental sync.
 *
 * Sized to outlast the slowest thing that can still change: an ACH return
 * window, a wire sitting in `awaiting_approval`, or a card authorization that
 * settles late. Cheaper to re-read 45 days than to miss a settlement.
 */
const OVERLAP_DAYS = 45;
const CHUNK = 200;

export interface SyncStats extends Record<string, number> {
  accounts: number;
  transactionsInserted: number;
  transactionsUpdated: number;
  transactionsUnchanged: number;
  customersUpserted: number;
  invoicesUpserted: number;
  invoicePayments: number;
}

export interface SyncResult {
  syncRunId: string;
  connectionId: string;
  status: "succeeded" | "failed";
  windowStart: Date | null;
  stats: SyncStats;
  error?: string;
  durationMs: number;
}

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const parseDate = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

/**
 * Resolves the access token for a connection.
 *
 * Stored tokens are envelope-encrypted and bound to the connection's own id, so
 * a ciphertext copied into another row will not decrypt. The `tokenRef` path is
 * the fallback for connections seeded from the environment (the local mock),
 * and never stores a token at all.
 */
export function connectionContext(connectionId: string): string {
  return `connection:${connectionId}`;
}

function resolveToken(connection: Connection): string {
  if (connection.tokenCiphertext) {
    return decryptSecret(
      connection.tokenCiphertext,
      connectionContext(connection.id),
    );
  }
  // No silent default: a connection without its own token must fail loudly
  // rather than borrow whichever token happens to be in the environment.
  if (!connection.tokenRef) {
    throw new Error(`Connection ${connection.id} has no stored access token.`);
  }
  const token = process.env[connection.tokenRef];
  if (!token) {
    throw new Error(
      `Connection token ref ${connection.tokenRef} is not set in the environment.`,
    );
  }
  return token;
}

/**
 * Stores a founder's Rho connection with its token encrypted.
 *
 * Reconnecting the same company updates the existing row rather than creating
 * a duplicate, so pasting a fresh token after the old one expires just works.
 * The id is generated here so the ciphertext can be bound to it in the same
 * insert — there is never a moment where the row exists without its token.
 */
export async function saveConnection(
  input: { ownerId: string; label: string; baseUrl: string; token: string },
  db: Database = getDb(),
): Promise<Connection> {
  const [existing] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.ownerId, input.ownerId),
        eq(connections.label, input.label),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(connections)
      .set({
        baseUrl: input.baseUrl,
        tokenCiphertext: encryptSecret(input.token, connectionContext(existing.id)),
        tokenRef: null,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(connections.id, existing.id))
      .returning();
    return updated;
  }

  const id = crypto.randomUUID();
  const [created] = await db
    .insert(connections)
    .values({
      id,
      ownerId: input.ownerId,
      label: input.label,
      baseUrl: input.baseUrl,
      tokenCiphertext: encryptSecret(input.token, connectionContext(id)),
    })
    .returning();
  return created;
}

export async function syncConnection(
  connectionId: string,
  options: { trigger?: string; fullRefresh?: boolean; db?: Database } = {},
): Promise<SyncResult> {
  const db = options.db ?? getDb();
  const startedAt = Date.now();

  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);

  if (!connection) throw new Error(`No connection with id ${connectionId}`);

  const windowStart =
    options.fullRefresh || !connection.syncedThrough
      ? null
      : new Date(
          connection.syncedThrough.getTime() - OVERLAP_DAYS * 86_400_000,
        );

  const [run] = await db
    .insert(syncRuns)
    .values({
      connectionId,
      trigger: options.trigger ?? "manual",
      windowStart,
      status: "running",
    })
    .returning();

  const stats: SyncStats = {
    accounts: 0,
    transactionsInserted: 0,
    transactionsUpdated: 0,
    transactionsUnchanged: 0,
    customersUpserted: 0,
    invoicesUpserted: 0,
    invoicePayments: 0,
  };

  try {
    const client = new RhoClient({
      baseUrl: connection.baseUrl,
      token: resolveToken(connection),
    });

    let newWatermark = connection.syncedThrough ?? null;

    // ---------------------------------------------------------- accounts
    for await (const account of client.allAccounts()) {
      const [row] = await db
        .insert(rhoAccounts)
        .values({
          connectionId,
          rhoAccountId: account.id,
          accountType: account.account_type,
          accountName: account.account_name ?? null,
          accountNumberLast4: account.account_number_last_4 ?? null,
          routingNumberLast4: account.routing_number_last_4 ?? null,
          balanceMinor: account.balance.amount,
          currency: account.balance.currency,
          balanceObservedAt: new Date(),
          payload: account,
        })
        .onConflictDoUpdate({
          target: [rhoAccounts.connectionId, rhoAccounts.rhoAccountId],
          set: {
            accountType: account.account_type,
            accountName: account.account_name ?? null,
            balanceMinor: account.balance.amount,
            currency: account.balance.currency,
            balanceObservedAt: new Date(),
            payload: account,
            updatedAt: new Date(),
          },
        })
        .returning();

      // One observation per sync: balances are point-in-time, and runway needs
      // to know what cash looked like historically, not just today.
      await db.insert(accountBalanceSnapshots).values({
        accountId: row.id,
        balanceMinor: account.balance.amount,
        currency: account.balance.currency,
      });
      stats.accounts += 1;
    }

    // ------------------------------------------------------ transactions
    const fetched: RhoTransaction[] = [];
    for await (const txn of client.allTransactions(
      windowStart ? { initiated_after: windowStart.toISOString() } : {},
    )) {
      fetched.push(txn);
      const initiated = new Date(txn.initiated_at);
      if (!newWatermark || initiated > newWatermark) newWatermark = initiated;
    }

    // Load the existing rows for exactly this id set, so change detection is
    // one query rather than one query per transaction.
    const existingByKey = new Map<
      string,
      { id: string; contentHash: string }
    >();
    for (const batch of chunked(fetched.map((t) => t.id))) {
      if (batch.length === 0) continue;
      const rows = await db
        .select({
          id: rhoTransactions.id,
          rhoTransactionId: rhoTransactions.rhoTransactionId,
          rhoAccountId: rhoTransactions.rhoAccountId,
          contentHash: rhoTransactions.contentHash,
        })
        .from(rhoTransactions)
        .where(
          and(
            eq(rhoTransactions.connectionId, connectionId),
            inArray(rhoTransactions.rhoTransactionId, batch),
          ),
        );
      for (const r of rows) {
        existingByKey.set(`${r.rhoTransactionId}::${r.rhoAccountId}`, {
          id: r.id,
          contentHash: r.contentHash,
        });
      }
    }

    const toInsert: (typeof rhoTransactions.$inferInsert)[] = [];
    const changed: { rowId: string; txn: RhoTransaction; hash: string }[] = [];
    const unchangedIds: string[] = [];

    for (const txn of fetched) {
      const hash = contentHash(txn);
      const existing = existingByKey.get(`${txn.id}::${txn.account_id}`);

      if (!existing) {
        toInsert.push({
          connectionId,
          rhoTransactionId: txn.id,
          rhoMoneyMovementId: txn.money_movement_id,
          rhoAccountId: txn.account_id,
          accountType: txn.account_type,
          accountName: txn.account_name,
          transactionType: txn.transaction_type,
          status: txn.status,
          amountMinor: txn.amount.amount,
          currency: txn.amount.currency,
          initiatedAt: new Date(txn.initiated_at),
          postedAt: parseDate(txn.posted_at),
          counterpartyName: txn.counterparty_name,
          counterpartyLogoUrl: txn.counterparty_logo_url,
          memo: txn.memo,
          note: txn.note,
          userId: txn.user_id,
          userFullName: txn.user_full_name,
          cardId: txn.card_id,
          cardName: txn.card_name,
          payload: txn,
          contentHash: hash,
        });
      } else if (existing.contentHash !== hash) {
        changed.push({ rowId: existing.id, txn, hash });
      } else {
        unchangedIds.push(existing.id);
      }
    }

    for (const batch of chunked(toInsert)) {
      const inserted = await db
        .insert(rhoTransactions)
        .values(batch)
        .returning({ id: rhoTransactions.id, hash: rhoTransactions.contentHash });
      await db.insert(rhoTransactionVersions).values(
        inserted.map((row, i) => ({
          transactionId: row.id,
          syncRunId: run.id,
          version: 1,
          status: batch[i].status,
          amountMinor: batch[i].amountMinor,
          postedAt: batch[i].postedAt ?? null,
          payload: batch[i].payload,
          contentHash: batch[i].contentHash,
        })),
      );
      stats.transactionsInserted += inserted.length;
    }

    for (const { rowId, txn, hash } of changed) {
      const [{ maxVersion }] = await db
        .select({
          maxVersion: sql<number>`coalesce(max(${rhoTransactionVersions.version}), 0)`,
        })
        .from(rhoTransactionVersions)
        .where(eq(rhoTransactionVersions.transactionId, rowId));

      await db
        .update(rhoTransactions)
        .set({
          status: txn.status,
          amountMinor: txn.amount.amount,
          postedAt: parseDate(txn.posted_at),
          memo: txn.memo,
          note: txn.note,
          counterpartyName: txn.counterparty_name,
          payload: txn,
          contentHash: hash,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(rhoTransactions.id, rowId));

      await db.insert(rhoTransactionVersions).values({
        transactionId: rowId,
        syncRunId: run.id,
        version: Number(maxVersion) + 1,
        status: txn.status,
        amountMinor: txn.amount.amount,
        postedAt: parseDate(txn.posted_at),
        payload: txn,
        contentHash: hash,
      });
      stats.transactionsUpdated += 1;
    }

    for (const batch of chunked(unchangedIds)) {
      if (batch.length === 0) continue;
      await db
        .update(rhoTransactions)
        .set({ lastSeenAt: new Date() })
        .where(inArray(rhoTransactions.id, batch));
    }
    stats.transactionsUnchanged = unchangedIds.length;

    // --------------------------------------------------------- customers
    for await (const customer of client.allInvoicingCustomers({
      include_deleted: "true",
    })) {
      await db
        .insert(rhoCustomers)
        .values({
          connectionId,
          rhoCustomerId: customer.id,
          legalName: customer.legal_name,
          email: customer.email ?? null,
          emailDomain: emailDomain(customer.email),
          totalRevenueMinor: customer.total_revenue?.amount ?? null,
          currency: customer.total_revenue?.currency ?? null,
          deletedAt: parseDate(customer.deleted_at),
          payload: customer,
          contentHash: contentHash(customer),
        })
        .onConflictDoUpdate({
          target: [rhoCustomers.connectionId, rhoCustomers.rhoCustomerId],
          set: {
            legalName: customer.legal_name,
            email: customer.email ?? null,
            emailDomain: emailDomain(customer.email),
            totalRevenueMinor: customer.total_revenue?.amount ?? null,
            deletedAt: parseDate(customer.deleted_at),
            payload: customer,
            contentHash: contentHash(customer),
            updatedAt: new Date(),
          },
        });
      stats.customersUpserted += 1;
    }

    // ---------------------------------------------------------- invoices
    for await (const invoice of client.allInvoicingInvoices()) {
      const [row] = await db
        .insert(rhoInvoices)
        .values({
          connectionId,
          rhoInvoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number ?? null,
          status: invoice.status,
          rhoCustomerId: invoice.customer.id,
          totalMinor: invoice.total.amount,
          currency: invoice.total.currency,
          issuedAt: parseDate(invoice.date),
          dueAt: parseDate(invoice.due_date),
          payload: invoice,
          contentHash: contentHash(invoice),
        })
        .onConflictDoUpdate({
          target: [rhoInvoices.connectionId, rhoInvoices.rhoInvoiceId],
          set: {
            status: invoice.status,
            totalMinor: invoice.total.amount,
            issuedAt: parseDate(invoice.date),
            dueAt: parseDate(invoice.due_date),
            payload: invoice,
            contentHash: contentHash(invoice),
            updatedAt: new Date(),
          },
        })
        .returning({ id: rhoInvoices.id });
      stats.invoicesUpserted += 1;

      // Payments are fully derived from the invoice payload, so replacing them
      // wholesale keeps them consistent without a diffing pass.
      await db
        .delete(rhoInvoicePayments)
        .where(eq(rhoInvoicePayments.invoiceId, row.id));

      if (invoice.payments.length > 0) {
        await db.insert(rhoInvoicePayments).values(
          invoice.payments.map((p) => ({
            invoiceId: row.id,
            connectionId,
            paymentType: p.type,
            externalMethod: p.external_method ?? null,
            paidAt: parseDate(p.paid_at),
            rhoTransactionId: p.transaction_id ?? null,
          })),
        );
        stats.invoicePayments += invoice.payments.length;
      }
    }

    await db
      .update(connections)
      .set({
        syncedThrough: newWatermark,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId));

    await db
      .update(syncRuns)
      .set({ status: "succeeded", finishedAt: new Date(), stats })
      .where(eq(syncRuns.id, run.id));

    return {
      syncRunId: run.id,
      connectionId,
      status: "succeeded",
      windowStart,
      stats,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        stats,
        error: message,
      })
      .where(eq(syncRuns.id, run.id));

    return {
      syncRunId: run.id,
      connectionId,
      status: "failed",
      windowStart,
      stats,
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Every connection belonging to one founder, newest first. */
export async function listConnections(
  ownerId: string,
  db: Database = getDb(),
): Promise<Connection[]> {
  return db
    .select()
    .from(connections)
    .where(eq(connections.ownerId, ownerId))
    .orderBy(desc(connections.createdAt));
}

/**
 * Loads a connection only if it belongs to `ownerId`.
 *
 * Returns null rather than throwing so callers answer "not found" for someone
 * else's connection — confirming that an id exists is itself a small leak.
 */
export async function getOwnedConnection(
  connectionId: string,
  ownerId: string,
  db: Database = getDb(),
): Promise<Connection | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(eq(connections.id, connectionId), eq(connections.ownerId, ownerId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Gets (or creates) a founder's connection to the mock API.
 *
 * Stands in for the real "connect your Rho account" flow: same table, same
 * encrypted-token path, with the token taken from the environment instead of
 * from a form.
 */
export async function ensureDevConnection(
  ownerId: string,
  db: Database = getDb(),
) {
  const label = "Northstar Labs (mock)";
  const [existing] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.ownerId, ownerId), eq(connections.label, label)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(connections)
    .values({
      ownerId,
      label,
      baseUrl:
        process.env.RHO_API_BASE_URL ?? "http://localhost:3000/api/mock/rho/v1",
      tokenRef: "RHO_API_TOKEN",
    })
    .returning();

  // Encrypt the environment token into the row so the local connection
  // exercises the same decrypt path a real one will. The context binds the
  // ciphertext to this connection's id, which only exists after the insert.
  const envToken = process.env.RHO_API_TOKEN;
  if (envToken) {
    const [stored] = await db
      .update(connections)
      .set({
        tokenCiphertext: encryptSecret(envToken, connectionContext(created.id)),
      })
      .where(eq(connections.id, created.id))
      .returning();
    return stored;
  }
  return created;
}

/**
 * The founder used when ingestion runs without a session — the CLI in
 * development. Keeps `connections.ownerId` non-null and the ownership rules
 * identical to the signed-in path, rather than carving out a special case.
 */
export async function ensureDemoFounder(db: Database = getDb()) {
  const email = "founder@northstarlabs.com";
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({ email, name: "Dana Whitfield" })
    .returning();
  return created;
}
