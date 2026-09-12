import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { seedDemo } from "@/lib/demo/seed";
import { discoverProfiles, getProfileSettings, saveProfileSettings } from "@/lib/profiles";
import { getReceiptBySlug, issueReceipt } from "@/lib/receipts";
import { cachedCustomerResearch } from "@/lib/research";

const state = vi.hoisted(() => ({ db: undefined as Database | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db!, isEmbedded: () => true }));

describe("demo, discovery and frozen research", () => {
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

  it("migrates and seeds two public companies with frozen simulated research", async () => {
    expect(await discoverProfiles()).toHaveLength(2);
    const receipt = await getReceiptBySlug(demo[0].receipt.split("/").at(-1)!);
    expect(receipt?.snapshot.metrics.mrr.value.minor).toBe(5_325_100);
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

  it("enforces ownership and rejects financial fields in settings", async () => {
    const company = demo[0];
    const settings = { description: "Updated", logoUrl: "", isPublic: true };
    await expect(saveProfileSettings(company.connectionId, demo[1].ownerId, settings)).rejects.toThrow("Connection not found");
    await expect(saveProfileSettings(company.connectionId, company.ownerId, { ...settings, mrr: 999 })).rejects.toThrow();
    await expect(saveProfileSettings(company.connectionId, company.ownerId, { ...settings, logoUrl: "javascript:alert(1)" })).rejects.toThrow();
  });

  it("unlisting hides discovery but preserves shared snapshots; new receipts capture new settings", async () => {
    const company = demo[0];
    const old = await getReceiptBySlug(company.receipt.split("/").at(-1)!);
    await saveProfileSettings(company.connectionId, company.ownerId, { description: "A new description", logoUrl: "", isPublic: false });
    expect(await discoverProfiles()).toHaveLength(1);
    expect(await getReceiptBySlug(old!.slug)).toEqual(old);
    const fresh = await issueReceipt({ connectionId: company.connectionId, ownerId: company.ownerId, asOf: new Date(old!.snapshot.asOf) });
    const updated = await getReceiptBySlug(fresh.slug);
    expect(updated!.snapshot.profile?.description).toBe("A new description");
    expect(updated!.snapshot.metrics).toEqual(old!.snapshot.metrics);
    expect(updated!.snapshot.customerResearch).toEqual(old!.snapshot.customerResearch);
    expect((await getProfileSettings(crypto.randomUUID())).isPublic).toBe(false);
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
