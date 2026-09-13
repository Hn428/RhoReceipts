/** Applies generated migrations against whichever driver is configured. */

import { migrate as migrateNode } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

import { getDb, isEmbedded, type Database } from "./index";

export async function runMigrations(db: Database = getDb()): Promise<void> {
  const config = { migrationsFolder: "./drizzle" };
  if (isEmbedded()) {
    await migratePglite(db as Parameters<typeof migratePglite>[0], config);
  } else {
    await migrateNode(db as Parameters<typeof migrateNode>[0], config);
  }
}
