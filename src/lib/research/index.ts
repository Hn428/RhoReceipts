import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customerResearchCache } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { researchCustomer, type ResearchSubject } from "./customer";

/** Connection scoping prevents research cache sharing across tenants. */
export async function cachedCustomerResearch(connectionId: string, subject: ResearchSubject) {
  const db = getDb();
  const now = new Date();
  const key = createHash("sha256").update(JSON.stringify({ version: 3, connectionId, ...subject })).digest("hex");
  const [cached] = await db.select().from(customerResearchCache).where(and(
    eq(customerResearchCache.key, key), gt(customerResearchCache.expiresAt, now),
  )).limit(1);
  if (cached) return cached.result;
  const result = await researchCustomer(subject, { apiKey: env().TAVILY_API_KEY, now });
  // Configuration errors and transient provider failures must be retryable immediately.
  if (result.provider !== "unavailable") {
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(customerResearchCache).values({ key, connectionId, result, expiresAt })
      .onConflictDoUpdate({ target: customerResearchCache.key, set: { result, expiresAt } });
  }
  return result;
}
