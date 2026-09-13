"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { connectionForOwner, saveConnection, syncConnection } from "@/lib/ingest/sync";
import { issueReceipt } from "@/lib/receipts";
import { RhoApiError, RhoClient } from "@/lib/rho/client";
import { companyBySlug } from "@/lib/rho/mock/store";
import type { RhoAccount } from "@/lib/rho/types";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "token" };

const DEFAULT_BASE_URL = "http://localhost:3000/api/mock/rho/v1";

/** "Acme AI — Operating" → "Acme AI". */
function companyNameFrom(accounts: RhoAccount[]): string {
  const named =
    accounts.find((a) => a.account_type === "checking" && a.account_name) ??
    accounts.find((a) => a.account_name);
  const name = named?.account_name?.split(/\s+[—–-]\s+/)[0]?.trim();
  if (name) return name;
  const last4 = accounts[0]?.account_number_last_4;
  return last4 ? `Rho account ····${last4}` : "Rho account";
}

/**
 * Step one of enrollment: connect and import the ledger.
 *
 * Deliberately stops short of generating anything. The founder sees what was
 * found and chooses to generate the first receipt — voluntary enrollment is
 * what gives the badge its meaning.
 */
export async function importLedger(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const ownerId = session.user.id;
  if (await connectionForOwner(ownerId)) {
    return { status: "error", message: "Your company is already connected. Open the dashboard to view its receipts." };
  }

  // A sample company is chosen by slug; its token never touches the browser.
  // Token-only companies aren't samples: they connect by pasting their token.
  const sampleSlug = formData.get("sample");
  const listed = typeof sampleSlug === "string" ? companyBySlug(sampleSlug) : null;
  const sample = listed && !listed.meta.token_only ? listed : null;
  const token = sample
    ? sample.meta.mock_token
    : String(formData.get("token") ?? "").trim();

  if (!token) {
    return { status: "error", field: "token", message: "Paste your Rho access token to continue." };
  }
  if (!sample && !/^rhobat_[A-Za-z0-9_]{16,}$/.test(token)) {
    return {
      status: "error",
      field: "token",
      message:
        'That doesn\'t look like a Rho access token. Tokens start with "rhobat_" — copy the whole value from Rho.',
    };
  }

  const baseUrl = process.env.RHO_API_BASE_URL ?? DEFAULT_BASE_URL;

  // Check the token with Rho before storing anything.
  const accounts: RhoAccount[] = [];
  try {
    for await (const account of new RhoClient({ baseUrl, token }).allAccounts()) {
      accounts.push(account);
    }
  } catch (error) {
    if (error instanceof RhoApiError && error.status === 401) {
      return {
        status: "error",
        field: "token",
        message:
          "Rho didn't accept this token. It may have been revoked, or expired after 45 days without use — create a new one and try again.",
      };
    }
    if (error instanceof RhoApiError && error.status === 403) {
      return {
        status: "error",
        field: "token",
        message:
          "This token can't read account data. Create a token with the accounts:read and transactions:read scopes.",
      };
    }
    console.error("Rho token check failed", error);
    return { status: "error", message: "Couldn't reach Rho to check the token. Try again in a moment." };
  }

  if (accounts.length === 0) {
    return { status: "error", field: "token", message: "This token works, but it can't see any accounts." };
  }

  let connectionId: string;
  try {
    const connection = await saveConnection({
      ownerId,
      label: companyNameFrom(accounts),
      baseUrl,
      token,
    });
    const result = await syncConnection(connection.id, { trigger: "enroll" });
    if (result.status === "failed") {
      console.error("Import failed during enrollment", result.error);
      return {
        status: "error",
        message: "Connected, but importing transactions failed. Try again.",
      };
    }
    connectionId = connection.id;
  } catch (error) {
    console.error("Enrollment import failed", error);
    return { status: "error", message: "Something went wrong while importing. Try again." };
  }

  revalidatePath("/dashboard");
  redirect(`/enroll/${connectionId}`);
}

/** Step two: the founder chooses to generate the first immutable receipt. */
export async function generateReceipt(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const connectionId = String(formData.get("connectionId") ?? "");
  let slug: string;
  try {
    ({ slug } = await issueReceipt({ connectionId, ownerId: session.user.id }));
  } catch (error) {
    console.error("Receipt generation failed", error);
    redirect(`/enroll/${connectionId}?error=generate`);
  }
  revalidatePath("/dashboard");
  redirect(`/r/${slug}`);
}
