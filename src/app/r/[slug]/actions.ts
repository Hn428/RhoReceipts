"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ReceiptShareError, shareReceiptWithInvestor } from "@/lib/receipts/sharing";

export async function shareReceipt(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const slug = String(formData.get("slug") ?? "");
  const email = String(formData.get("email") ?? "");
  let result: "sent" | "already_sent";
  try {
    result = await shareReceiptWithInvestor({ slug, email, ownerId: session.user.id });
  } catch (error) {
    if (!(error instanceof ReceiptShareError)) console.error("Receipt share failed", error);
    redirect(`/r/${slug}?share=${error instanceof ReceiptShareError && error.message.startsWith("Invalid") ? "email" : "failed"}`);
  }

  revalidatePath("/investor");
  redirect(`/r/${slug}?share=${result}`);
}
