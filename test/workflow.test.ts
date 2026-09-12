import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { seedDemo } from "@/lib/demo/seed";
import { connectionForOwner, saveConnection } from "@/lib/ingest/sync";
import { getReceiptBySlug, issueReceipt, receiptsFor } from "@/lib/receipts";
import { STALE_CLAIM_MS } from "@/lib/mail";
import { receiptsSharedWithInvestor, shareReceiptWithInvestor } from "@/lib/receipts/sharing";
import { cachedCustomerResearch } from "@/lib/research";
import { reportsSharedWithInvestor } from "@/lib/reports";

const state = vi.hoisted(() => ({ db: undefined as Database | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db!, isEmbedded: () => true }));

describe("demo, private delivery and frozen research", () => {
  let client: PGlite;
  let demo: Awaited<ReturnType<typeof seedDemo>>;
  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-secret");
    vi.stubEnv("TAVILY_API_KEY", "test-research-key");
    client = new PGlite();
    state.db = drizzle(client, { schema }) as unknown as Database;
    vi.spyOn(console, "log").mockImplementation(() => {});
    demo = await seedDemo("http://localhost:3000");
  }, 30_000);
  afterAll(async () => { await client.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("migrates and seeds two companies with frozen simulated research", async () => {
    const receipt = await getReceiptBySlug(demo[0].receipt.split("/").at(-1)!);
    expect(receipt?.snapshot.metrics.mrr.value.minor).toBe(5_325_100);
    expect(receipt?.snapshot.profile).toBeUndefined();
    expect(Object.values(receipt!.snapshot.customerResearch!).length).toBeGreaterThan(0);
    expect(Object.values(receipt!.snapshot.customerResearch!).every((r) => r.provider === "simulated")).toBe(true);
    expect(demo.every((company) => company.delivered === 1)).toBe(true);
  });

  it("enables row-level security on every public table", async () => {
    const { rows } = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(19);
    expect(rows.filter((row) => !row.relrowsecurity).map((row) => row.relname)).toEqual([]);
  });

  it("repeated setup reuses snapshots and never duplicates delivery", async () => {
    const before = await state.db!.select().from(schema.receipts);
    const repeated = await seedDemo("http://localhost:3000");
    expect(repeated.every((company) => company.delivered === 0)).toBe(true);
    expect(await state.db!.select().from(schema.receipts)).toHaveLength(before.length);
    expect(await state.db!.select().from(schema.reportDeliveries)).toHaveLength(2);
  }, 30_000);

  it("resyncs in batches without duplicating payments and versions a changed transaction", async () => {
    const db = state.db!;
    const { connectionId } = demo[0];
    const paymentPairs = async () => (await db
      .select()
      .from(schema.rhoInvoicePayments)
      .where(eq(schema.rhoInvoicePayments.connectionId, connectionId)))
      .map((p) => `${p.invoiceId}:${p.rhoTransactionId}:${p.paidAt?.toISOString()}`)
      .sort();
    const [target] = await db
      .select()
      .from(schema.rhoTransactions)
      .where(eq(schema.rhoTransactions.connectionId, connectionId))
      .limit(1);
    const accounts = await db.select().from(schema.rhoAccounts);
    const snapshotsBefore = (await db.select().from(schema.accountBalanceSnapshots)).length;
    const transactionsBefore = (await db.select().from(schema.rhoTransactions)).length;
    const invoicesBefore = (await db.select().from(schema.rhoInvoices)).length;
    const customersBefore = (await db.select().from(schema.rhoCustomers)).length;
    const pairsBefore = await paymentPairs();
    expect(pairsBefore.length).toBeGreaterThan(0);

    // A stale hash makes the next sync treat this row as changed at the source.
    await db.update(schema.rhoTransactions).set({ contentHash: "stale" }).where(eq(schema.rhoTransactions.id, target.id));
    await seedDemo("http://localhost:3000");

    const [resynced] = await db.select().from(schema.rhoTransactions).where(eq(schema.rhoTransactions.id, target.id));
    expect(resynced.contentHash).toBe(target.contentHash);
    const versions = await db
      .select()
      .from(schema.rhoTransactionVersions)
      .where(eq(schema.rhoTransactionVersions.transactionId, target.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);

    expect(await paymentPairs()).toEqual(pairsBefore);
    expect(await db.select().from(schema.rhoAccounts)).toHaveLength(accounts.length);
    // Seeding syncs each company twice: the import, then again before the monthly report.
    expect(await db.select().from(schema.accountBalanceSnapshots)).toHaveLength(snapshotsBefore + 2 * accounts.length);
    expect(await db.select().from(schema.rhoTransactions)).toHaveLength(transactionsBefore);
    expect(await db.select().from(schema.rhoInvoices)).toHaveLength(invoicesBefore);
    expect(await db.select().from(schema.rhoCustomers)).toHaveLength(customersBefore);
  }, 60_000);

  it("retries failed and crashed monthly deliveries, but not one still in flight", async () => {
    const [report] = await state.db!
      .select()
      .from(schema.monthlyReports)
      .where(eq(schema.monthlyReports.connectionId, demo[0].connectionId));
    const mark = (status: string, claimedAt: Date) => state.db!
      .update(schema.reportDeliveries)
      .set({ status, claimedAt })
      .where(eq(schema.reportDeliveries.reportId, report.id));
    const deliveredToFirstCompany = async () => (await seedDemo("http://localhost:3000"))[0].delivered;

    await mark("failed", new Date());
    expect(await deliveredToFirstCompany()).toBe(1);

    await mark("sending", new Date());
    expect(await deliveredToFirstCompany()).toBe(0);

    await mark("sending", new Date(Date.now() - STALE_CLAIM_MS - 1_000));
    expect(await deliveredToFirstCompany()).toBe(1);

    const [row] = await state.db!
      .select()
      .from(schema.reportDeliveries)
      .where(eq(schema.reportDeliveries.reportId, report.id));
    expect(row.status).toBe("sent");
    expect(await state.db!.select().from(schema.reportDeliveries)).toHaveLength(2);
  }, 60_000);

  it("allows one company per founder while permitting a credential refresh", async () => {
    const original = await connectionForOwner(demo[0].ownerId);
    expect(original?.id).toBe(demo[0].connectionId);

    const refreshed = await saveConnection({
      ownerId: demo[0].ownerId,
      label: original!.label,
      baseUrl: original!.baseUrl,
      token: "rho_mock_refreshed_token",
    });
    expect(refreshed.id).toBe(original!.id);

    await expect(saveConnection({
      ownerId: demo[0].ownerId,
      label: "Another Company",
      baseUrl: original!.baseUrl,
      token: "rho_mock_another_token",
    })).rejects.toThrow("already has a company connected");
  });

  it("keeps every generated receipt in the company history, newest first", async () => {
    const company = demo[0];
    const before = await receiptsFor(company.connectionId, company.ownerId);
    const issued = await issueReceipt({
      connectionId: company.connectionId,
      ownerId: company.ownerId,
      asOf: new Date("2026-09-01T00:00:00.000Z"),
    });
    const history = await receiptsFor(company.connectionId, company.ownerId);

    expect(history).toHaveLength(before.length + 1);
    expect(history[0].slug).toBe(issued.slug);
    expect(history.map((receipt) => receipt.slug)).toEqual(
      expect.arrayContaining(before.map((receipt) => receipt.slug)),
    );
  });

  it("shares one exact receipt once and exposes it only to that investor", async () => {
    const company = demo[0];
    const slug = company.receipt.split("/").at(-1)!;
    const messagesBefore = vi.mocked(console.log).mock.calls.length;

    expect(await shareReceiptWithInvestor({
      slug,
      ownerId: company.ownerId,
      email: "  DIRECT@EXAMPLE.TEST ",
    })).toBe("sent");
    expect(await shareReceiptWithInvestor({
      slug,
      ownerId: company.ownerId,
      email: "direct@example.test",
    })).toBe("already_sent");
    expect(vi.mocked(console.log).mock.calls.length).toBe(messagesBefore + 1);

    const shared = await receiptsSharedWithInvestor("direct@example.test");
    expect(shared.map((receipt) => receipt.slug)).toEqual([slug]);
    expect(await receiptsSharedWithInvestor("someone-else@example.test")).toEqual([]);
    await expect(shareReceiptWithInvestor({
      slug,
      ownerId: demo[1].ownerId,
      email: "direct@example.test",
    })).rejects.toThrow("Receipt not found");
  });

  it("retakes a share that crashed mid-send, but not one still in flight", async () => {
    const company = demo[0];
    const slug = company.receipt.split("/").at(-1)!;
    const receipt = await getReceiptBySlug(slug);
    const claim = (email: string, claimedAt: Date) => state.db!.insert(schema.receiptShares).values({
      receiptId: receipt!.id,
      connectionId: company.connectionId,
      ownerId: company.ownerId,
      email,
      claimedAt,
    });

    await claim("in-flight@example.test", new Date());
    expect(await shareReceiptWithInvestor({ slug, ownerId: company.ownerId, email: "in-flight@example.test" }))
      .toBe("already_sent");

    await claim("crashed@example.test", new Date(Date.now() - STALE_CLAIM_MS - 1_000));
    expect(await shareReceiptWithInvestor({ slug, ownerId: company.ownerId, email: "crashed@example.test" }))
      .toBe("sent");
    expect((await receiptsSharedWithInvestor("crashed@example.test")).map((shared) => shared.slug)).toEqual([slug]);
  });

  it("shows investors only receipts delivered to their currently authorized email", async () => {
    const shared = await reportsSharedWithInvestor("  INVESTOR@example.test ");
    expect(shared.map((report) => report.connectionId).sort()).toEqual(
      demo.map((company) => company.connectionId).sort(),
    );
    expect(await reportsSharedWithInvestor("someone-else@example.test")).toEqual([]);

    await state.db!
      .delete(schema.investorRecipients)
      .where(eq(schema.investorRecipients.connectionId, demo[0].connectionId));
    const afterRevocation = await reportsSharedWithInvestor("investor@example.test");
    expect(afterRevocation.map((report) => report.connectionId)).not.toContain(demo[0].connectionId);
    expect(afterRevocation.map((report) => report.connectionId)).toContain(demo[1].connectionId);
  });

  it("caches successful searches by connection and refreshes after expiry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ results: [{ title: "Real Widgets", url: "https://realwidgets.com", content: "Real Widgets" }] })));
    vi.stubGlobal("fetch", fetcher);
    const subject = { name: "Real Widgets", domain: "realwidgets.com", isDemo: false, relatedParty: false };
    const first = await cachedCustomerResearch(demo[0].connectionId, subject);
    expect(first.status).toBe("Verified");
    expect(await cachedCustomerResearch(demo[0].connectionId, subject)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await cachedCustomerResearch(demo[1].connectionId, subject);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await state.db!.update(schema.customerResearchCache).set({ expiresAt: new Date(0) }).where(eq(schema.customerResearchCache.connectionId, demo[0].connectionId));
    await cachedCustomerResearch(demo[0].connectionId, subject);
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});
