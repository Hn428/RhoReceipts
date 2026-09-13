/**
 * Runs once when the server starts, before any request is handled.
 *
 * The embedded database is created empty on first use, so the schema has to be
 * applied somewhere. Doing it here rather than inside a route means signing in
 * works on a fresh checkout without having run an ingest first — the failure it
 * prevents is an adapter error on the very first query against `user`.
 *
 * Migrations are idempotent, so re-running on every boot is free.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isEmbedded } = await import("@/lib/db");
  if (!isEmbedded()) return;

  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();
}
