"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getOwnedConnection, syncConnection } from "@/lib/ingest/sync";
import { issueReceipt } from "@/lib/receipts";

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
