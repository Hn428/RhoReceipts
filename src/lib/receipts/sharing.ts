import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { receipts, receiptShares } from "@/lib/db/schema";
import { sendMail } from "@/lib/mail";
import type { ReceiptSnapshot } from "@/lib/receipts";

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]!);

export class ReceiptShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptShareError";
  }
}

/** Shares one exact frozen receipt and sends its link once per email. */
export async function shareReceiptWithInvestor(options: {
  slug: string;
  ownerId: string;
  email: string;
}): Promise<"sent" | "already_sent"> {
  const email = options.email.trim().toLowerCase();
  if (!emailPattern.test(email)) throw new ReceiptShareError("Invalid email address.");

  const db = getDb();
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.slug, options.slug), eq(receipts.ownerId, options.ownerId)))
    .limit(1);
  if (!receipt) throw new ReceiptShareError("Receipt not found.");

  let [claim] = await db
    .insert(receiptShares)
    .values({
      receiptId: receipt.id,
      connectionId: receipt.connectionId,
      ownerId: options.ownerId,
      email,
    })
    .onConflictDoNothing()
    .returning();

  if (!claim) {
    [claim] = await db
      .update(receiptShares)
      .set({ status: "sending", error: null })
      .where(
        and(
          eq(receiptShares.receiptId, receipt.id),
          eq(receiptShares.email, email),
          eq(receiptShares.status, "failed"),
        ),
      )
      .returning();
    if (!claim) return "already_sent";
  }

  const snapshot = receipt.snapshot as ReceiptSnapshot;
  const receiptUrl = `${appUrl()}/r/${receipt.slug}`;
  const safeCompanyName = escapeHtml(receipt.companyName);
  try {
    const result = await sendMail({
      to: email,
      subject: `${receipt.companyName} shared a verified receipt with you`,
      text: [
        `${receipt.companyName} shared a Rho Receipt with you.`,
        "",
        `Open the receipt: ${receiptUrl}`,
        `Sign in to your investor portfolio: ${appUrl()}/auth/view/investor`,
        ...(snapshot.isDemo ? ["", "Sample company — figures come from a simulated ledger."] : []),
        "",
        "Rho Receipts is an independent project, not a Rho product.",
      ].join("\n"),
      html: `<!doctype html><html><body><p><strong>${safeCompanyName}</strong> shared a Rho Receipt with you.</p><p><a href="${receiptUrl}">Open the verified receipt</a></p><p><a href="${appUrl()}/auth/view/investor">Open your investor portfolio</a></p><p>Rho Receipts is an independent project, not a Rho product.</p></body></html>`,
    });
    await db
      .update(receiptShares)
      .set({ status: "sent", transport: result.transport, sentAt: new Date(), error: null })
      .where(eq(receiptShares.id, claim.id));
    return "sent";
  } catch (error) {
    await db
      .update(receiptShares)
      .set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      .where(eq(receiptShares.id, claim.id));
    throw error;
  }
}

/** Exact receipts successfully shared with an investor, newest share first. */
export async function receiptsSharedWithInvestor(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];

  return getDb()
    .select({
      shareId: receiptShares.id,
      sharedAt: receiptShares.sentAt,
      slug: receipts.slug,
      companyName: receipts.companyName,
      asOf: receipts.asOf,
      engineVersion: receipts.engineVersion,
      snapshot: receipts.snapshot,
    })
    .from(receiptShares)
    .innerJoin(receipts, eq(receiptShares.receiptId, receipts.id))
    .where(and(eq(receiptShares.email, normalizedEmail), eq(receiptShares.status, "sent")))
    .orderBy(desc(receiptShares.sentAt), desc(receiptShares.createdAt))
    .then((rows) => rows.map((row) => ({ ...row, snapshot: row.snapshot as ReceiptSnapshot })));
}
