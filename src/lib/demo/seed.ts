import "server-only";

import { getDb } from "@/lib/db";
import { users, investorRecipients } from "@/lib/db/schema";
import { runMigrations } from "@/lib/db/migrate";
import { saveConnection, syncConnection } from "@/lib/ingest/sync";
import { latestReceiptFor } from "@/lib/receipts";
import { sendMonthlyReport } from "@/lib/reports";
import { mockCompanies } from "@/lib/rho/mock/store";
import { GET as accounts } from "@/app/api/mock/rho/v1/accounts/route";
import { GET as transactions } from "@/app/api/mock/rho/v1/transactions/route";
import { GET as customers } from "@/app/api/mock/rho/v1/invoicing/customers/route";
import { GET as invoices } from "@/app/api/mock/rho/v1/invoicing/invoices/route";

/** Executes the actual mock route handlers, including token checks and pagination. */
export function demoFetch(appUrl: string): typeof fetch {
  const routes: Record<string, (request: Request) => Promise<Response>> = {
    "/api/mock/rho/v1/accounts": accounts,
    "/api/mock/rho/v1/transactions": transactions,
    "/api/mock/rho/v1/invoicing/customers": customers,
    "/api/mock/rho/v1/invoicing/invoices": invoices,
  };
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const handler = routes[url.pathname];
    if (url.origin !== new URL(appUrl).origin || !handler) throw new Error("Demo seeding only permits local mock Rho requests.");
    return handler(request);
  };
}

/** Intended only for the isolated demo database or an in-memory integration test. */
export async function seedDemo(appUrl: string) {
  await runMigrations();
  const db = getDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = demoFetch(appUrl);
  const output = [];
  try {
    for (const company of mockCompanies) {
      const ownerId = `demo-${company.meta.slug}`;
      const email = `founder+${company.meta.slug}@example.test`;
      await db.insert(users).values({ id: ownerId, email, name: `${company.meta.company} founder` }).onConflictDoNothing();
      const connection = await saveConnection({
        ownerId, label: `${company.meta.company} (mock)`, baseUrl: `${appUrl}/api/mock/rho/v1`, token: company.meta.mock_token,
      });
      const sync = await syncConnection(connection.id, { trigger: "demo", fullRefresh: true });
      if (sync.status !== "succeeded") throw new Error(`Demo import failed for ${company.meta.company}`);
      await db.insert(investorRecipients).values({ connectionId: connection.id, ownerId, email: "investor@example.test", name: "Demo investor" }).onConflictDoNothing();
      const report = await sendMonthlyReport({ connectionId: connection.id, ownerId, asOf: new Date(company.meta.anchor), trigger: "manual" });
      const receipt = await latestReceiptFor(connection.id, ownerId);
      output.push({ company: company.meta.company, ownerId, connectionId: connection.id, email,
        receipt: `/r/${receipt!.slug}`, report: `/m/${report.slug}`, delivered: report.delivered });
    }
  } finally { globalThis.fetch = originalFetch; }
  return output;
}
