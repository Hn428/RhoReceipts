/**
 * POST /api/sync — run ingestion for the signed-in founder's connection.
 *
 * Production path; the CLI in scripts/sync.ts drives this same route so dev and
 * prod cannot drift.
 */

import { auth } from "@/auth";
import {
  ensureDemoFounder,
  ensureDevConnection,
  getOwnedConnection,
  syncConnection,
} from "@/lib/ingest/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req
    .json()
    .catch(() => ({}))) as { connection_id?: string; full_refresh?: boolean };

  const session = await auth();
  let ownerId = session?.user?.id;

  if (!ownerId) {
    // The CLI has no cookies. In development it falls back to a seeded founder
    // so `npm run sync` keeps working; in production, sync requires a session.
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Sign in to sync a connection." },
        { status: 401 },
      );
    }
    ownerId = (await ensureDemoFounder()).id;
  }

  const connection = body.connection_id
    ? await getOwnedConnection(body.connection_id, ownerId)
    : await ensureDevConnection(ownerId);

  if (!connection) {
    return Response.json({ error: "Connection not found." }, { status: 404 });
  }

  const result = await syncConnection(connection.id, {
    trigger: "api",
    fullRefresh: body.full_refresh ?? false,
  });

  return Response.json(result, {
    status: result.status === "failed" ? 500 : 200,
  });
}
