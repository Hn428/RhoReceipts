/**
 * Database connection.
 *
 * Same swap philosophy as the Rho client: set DATABASE_URL and you are on a
 * real Postgres server; leave it unset and you get PGlite, which is Postgres
 * compiled to WASM running out of a local directory. Identical SQL dialect,
 * identical Drizzle schema, no setup. Development never blocks on infra, and
 * moving to Neon/Supabase/RDS is one environment variable.
 */

import { drizzle as drizzleNode } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as schema from "./schema";

/**
 * Driver-agnostic handle. Typed against Drizzle's shared `PgDatabase` base
 * rather than a union of the two concrete drivers — a union collapses the
 * query-builder overloads (`.returning()` stops accepting arguments), which
 * would force every call site to know which driver it is talking to.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * The embedded database lives outside the project directory by default.
 *
 * A Postgres data directory cannot survive a file-syncing service: iCloud and
 * Dropbox resolve conflicts by duplicating files, and a `base 2` folder beside
 * `base` corrupts the cluster — PGlite then aborts inside WASM with an error
 * that looks like a driver bug rather than a sync artefact. Keeping the data
 * under ~/.cache puts it somewhere nothing syncs. Override with PGLITE_DIR.
 */
const PGLITE_DIR =
  process.env.PGLITE_DIR ?? join(homedir(), ".cache", "rho-receipts", "pglite");

/**
 * Cached on globalThis so Next's hot reload doesn't open a second PGlite handle
 * against the same directory (which deadlocks on the file lock).
 */
const globalForDb = globalThis as unknown as {
  __rhoReceiptsDb?: Database;
  __rhoReceiptsPglite?: PGlite;
};

export function getDb(): Database {
  if (globalForDb.__rhoReceiptsDb) return globalForDb.__rhoReceiptsDb;

  const url = process.env.DATABASE_URL;
  let db: Database;

  if (url) {
    const client = postgres(url, { max: 5 });
    db = drizzleNode(client, { schema }) as unknown as Database;
  } else {
    // PGlite creates the data directory but not its parents, and ~/.cache does
    // not exist by default on macOS.
    mkdirSync(PGLITE_DIR, { recursive: true });
    const client = new PGlite(PGLITE_DIR);
    globalForDb.__rhoReceiptsPglite = client;
    db = drizzlePglite(client, { schema }) as unknown as Database;
  }

  globalForDb.__rhoReceiptsDb = db;
  return db;
}

/** True when running on embedded PGlite rather than a real server. */
export function isEmbedded(): boolean {
  return !process.env.DATABASE_URL;
}

export { schema };
