import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customerResearchCache } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { isComplete, researchCustomer, type CustomerResearch, type ResearchSubject } from "./customer";
import { researchVendor, type VendorResearch } from "./vendor";

const CACHE_DAYS = 30;

/**
 * Connection scoping prevents research cache sharing across tenants. A result
 * is cached only when every check completed, so a transient provider failure
 * is retried at the next issuance instead of being frozen for a month.
 */
async function cached<T extends CustomerResearch | VendorResearch>(
  connectionId: string,
  identity: object,
  run: (now: Date) => Promise<T>,
  cacheable: (result: T) => boolean,
): Promise<T> {
  const db = getDb();
  const now = new Date();
  const key = createHash("sha256").update(JSON.stringify({ connectionId, ...identity })).digest("hex");
  const [hit] = await db.select().from(customerResearchCache).where(and(
    eq(customerResearchCache.key, key), gt(customerResearchCache.expiresAt, now),
  )).limit(1);
  if (hit) return hit.result as T;
  const result = await run(now);
  if (cacheable(result)) {
    const expiresAt = new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(customerResearchCache).values({ key, connectionId, result, expiresAt })
      .onConflictDoUpdate({ target: customerResearchCache.key, set: { result, expiresAt } });
  }
  return result;
}

export function cachedCustomerResearch(connectionId: string, subject: ResearchSubject): Promise<CustomerResearch> {
  const { TAVILY_API_KEY, OPENAI_API_KEY, OPENAI_RESEARCH_MODEL } = env();
  const openai = OPENAI_API_KEY ? { apiKey: OPENAI_API_KEY, model: OPENAI_RESEARCH_MODEL } : undefined;
  return cached(
    connectionId,
    // The judge is part of the identity: switching it on or changing model re-judges.
    { version: 5, judge: openai?.model ?? "rules", ...subject },
    (now) => researchCustomer(subject, { apiKey: TAVILY_API_KEY, openai, now }),
    isComplete,
  );
}

export function cachedVendorResearch(connectionId: string, name: string): Promise<VendorResearch> {
  return cached(
    connectionId,
    { version: 1, kind: "vendor", name },
    (now) => researchVendor(name, { apiKey: env().TAVILY_API_KEY, now }),
    (result) => result.provider !== "unavailable",
  );
}
