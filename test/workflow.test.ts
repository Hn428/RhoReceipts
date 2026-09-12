import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { seedDemo } from "@/lib/demo/seed";
import { connectionForOwner, saveConnection } from "@/lib/ingest/sync";
import { getReceiptBySlug, issueReceipt, receiptsFor } from "@/lib/receipts";
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

  it("repeated setup reuses snapshots and never duplicates delivery", async () => {
    const before = await state.db!.select().from(schema.receipts);
    const repeated = await seedDemo("http://localhost:3000");
    expect(repeated.every((company) => company.delivered === 0)).toBe(true);
    expect(await state.db!.select().from(schema.receipts)).toHaveLength(before.length);
    expect(await state.db!.select().from(schema.reportDeliveries)).toHaveLength(2);
  }, 30_000);

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
