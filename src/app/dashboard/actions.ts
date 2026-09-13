"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getOwnedConnection, syncConnection } from "@/lib/ingest/sync";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { investorRecipients } from "@/lib/db/schema";
import { issueReceipt } from "@/lib/receipts";
import { sendMonthlyReport } from "@/lib/reports";

/** Pulls the latest activity from Rho, then issues a new receipt from it. */
export async function issueFreshReceipt(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const connectionId = String(formData.get("connectionId") ?? "");
  // Ownership is checked before sync, which does not check it itself.
  const connection = await getOwnedConnection(connectionId, session.user.id);
  if (!connection) redirect("/dashboard");

  const result = await syncConnection(connection.id, { trigger: "reissue" });
  if (result.status === "failed") {
    console.error("Sync before reissue failed", result.error);
    redirect("/dashboard?error=sync");
  }

  const { slug } = await issueReceipt({
    connectionId: connection.id,
    ownerId: session.user.id,
  });
  revalidatePath("/dashboard");
  redirect(`/r/${slug}`);
}

async function ownedConnectionFrom(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const connection = await getOwnedConnection(String(formData.get("connectionId") ?? ""), session.user.id);
  if (!connection) redirect("/dashboard");
  return { connection, ownerId: session.user.id };
}

/** Recipients are settings, not figures: founders manage who hears, never what. */
export async function addRecipient(formData: FormData) {
  const { connection, ownerId } = await ownedConnectionFrom(formData);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/dashboard?error=email");
  await getDb()
    .insert(investorRecipients)
    .values({ connectionId: connection.id, ownerId, email, name })
    .onConflictDoNothing();
  revalidatePath("/dashboard");
}

export async function removeRecipient(formData: FormData) {
  const { connection, ownerId } = await ownedConnectionFrom(formData);
  await getDb()
    .delete(investorRecipients)
    .where(
      and(
        eq(investorRecipients.id, String(formData.get("recipientId") ?? "")),
        eq(investorRecipients.connectionId, connection.id),
        eq(investorRecipients.ownerId, ownerId),
      ),
    );
  revalidatePath("/dashboard");
}

/** The same path the monthly cron runs, triggered by hand for the demo. */
export async function sendReportNow(formData: FormData) {
  const { connection, ownerId } = await ownedConnectionFrom(formData);
  let slug: string;
  try {
    ({ slug } = await sendMonthlyReport({ connectionId: connection.id, ownerId, trigger: "manual" }));
  } catch (error) {
    console.error("Manual monthly receipt failed", error);
    redirect("/dashboard?error=report");
  }
  revalidatePath("/dashboard");
  redirect(`/m/${slug}`);
}
