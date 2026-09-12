/**
 * GET /api/cron/monthly-receipts — runs on the 1st of each month (vercel.json).
 *
 * Safe to run any number of times: each company gets one report per month and
 * each investor one delivery per report, enforced by the database.
 */

import { enrolledConnections, sendMonthlyReport } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const results = [];
  for (const connection of await enrolledConnections()) {
    try {
      const result = await sendMonthlyReport({
        connectionId: connection.id,
        ownerId: connection.ownerId,
        trigger: "cron",
      });
      results.push({ connection: connection.label, ...result });
    } catch (error) {
      console.error("Monthly receipt failed", connection.id, error);
      results.push({ connection: connection.label, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return Response.json({ ran: results.length, results });
}
