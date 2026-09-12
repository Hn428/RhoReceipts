"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { saveConnection, syncConnection } from "@/lib/ingest/sync";
import { issueReceipt } from "@/lib/receipts";
import { RhoApiError, RhoClient } from "@/lib/rho/client";
import type { RhoAccount } from "@/lib/rho/types";

export type ConnectState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "token" };

const DEFAULT_BASE_URL = "http://localhost:3000/api/mock/rho/v1";

/** "Northstar Labs — Operating" → "Northstar Labs". */
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
 * Connects a Rho account, imports its ledger, and issues the first receipt.
 *
 * The token is checked against Rho before anything is stored, so a bad token
 * produces an error on the form rather than a saved connection that fails
 * later. Once accepted it is encrypted, bound to the connection, and never
 * returned to the browser again.
 */
export async function connectRhoAccount(
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const ownerId = session.user.id;

  const useDemo = formData.get("mode") === "demo";
  const token = useDemo
    ? process.env.RHO_API_TOKEN
    : String(formData.get("token") ?? "").trim();

  if (!token) {
    return useDemo
      ? { status: "error", message: "The sample company isn't configured on this server." }
      : { status: "error", field: "token", message: "Paste your Rho access token to continue." };
  }
  if (!useDemo && !/^rhobat_[A-Za-z0-9_]{16,}$/.test(token)) {
    return {
      status: "error",
      field: "token",
      message:
        'That doesn\'t look like a Rho access token. Tokens start with "rhobat_" — copy the whole value from Rho.',
    };
  }

  const baseUrl = process.env.RHO_API_BASE_URL ?? DEFAULT_BASE_URL;

  // --- Check the token with Rho before storing anything -------------------
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
          "Rho didn't accept this token. It may have been revoked, or expired after 45 days without use — create a new one in Rho and try again.",
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
    return {
      status: "error",
      message: "Couldn't reach Rho to check the token. Try again in a moment.",
    };
  }

  if (accounts.length === 0) {
    return {
      status: "error",
      field: "token",
      message: "This token works, but it can't see any accounts.",
    };
  }

  // --- Store, import, issue -----------------------------------------------
  let slug: string;
  try {
    const connection = await saveConnection({
      ownerId,
      label: companyNameFrom(accounts),
      baseUrl,
      token,
    });

    const result = await syncConnection(connection.id, { trigger: "connect" });
    if (result.status === "failed") {
      console.error("Import failed after connecting", result.error);
      return {
        status: "error",
        message:
          "Your account is connected, but importing transactions failed. Try connecting again.",
      };
    }

    ({ slug } = await issueReceipt({ connectionId: connection.id, ownerId }));
  } catch (error) {
    console.error("Connect flow failed", error);
    return {
      status: "error",
      message: "Something went wrong while importing your transactions. Try again.",
    };
  }

  revalidatePath("/dashboard");
  // Outside the try block: redirect works by throwing.
  redirect(`/r/${slug}`);
}
