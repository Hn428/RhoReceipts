import "server-only";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { profileSettings, receipts } from "@/lib/db/schema";
import { getOwnedConnection } from "@/lib/ingest/sync";
import type { ReceiptSnapshot } from "@/lib/receipts";

export const profileInput = z.object({
  description: z.string().trim().max(500),
  logoUrl: z.string().trim().max(2048).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch { return false; }
  }, "Use an HTTPS logo URL."),
  isPublic: z.boolean(),
}).strict();

export async function getProfileSettings(connectionId: string) {
  const [row] = await getDb().select().from(profileSettings).where(eq(profileSettings.connectionId, connectionId)).limit(1);
  return row ?? { connectionId, description: "", logoUrl: null, isPublic: false };
}

export async function saveProfileSettings(connectionId: string, ownerId: string, input: unknown) {
  if (!await getOwnedConnection(connectionId, ownerId)) throw new Error("Connection not found.");
  const parsed = profileInput.parse(input);
  const values = { ...parsed, logoUrl: parsed.logoUrl || null };
  await getDb().insert(profileSettings).values({ connectionId, ...values })
    .onConflictDoUpdate({ target: profileSettings.connectionId, set: values });
}

/** No ledger rows, owner identifiers or tokens are exposed to discovery. */
export async function discoverProfiles() {
  const rows = await getDb().select({
    connectionId: receipts.connectionId, slug: receipts.slug, snapshot: receipts.snapshot,
    description: profileSettings.description, logoUrl: profileSettings.logoUrl,
  }).from(profileSettings).innerJoin(receipts, eq(profileSettings.connectionId, receipts.connectionId))
    .where(eq(profileSettings.isPublic, true)).orderBy(desc(receipts.createdAt), desc(receipts.id));
  const seen = new Set<string>();
  return rows.flatMap(({ connectionId, snapshot, ...row }) => {
    if (seen.has(connectionId)) return [];
    seen.add(connectionId);
    const s = snapshot as ReceiptSnapshot;
    return [{ ...row, companyName: s.companyName, isDemo: s.isDemo, period: s.reportingPeriod.label,
      mrr: s.metrics.mrr.value, growth: s.metrics.growth3Month?.value ?? null,
      runway: s.metrics.runwayMonths.value, concentration: s.metrics.concentration.value.topCustomerShare }];
  }).sort((a, b) => a.companyName.localeCompare(b.companyName));
}
