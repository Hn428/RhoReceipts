import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read Next's env files. Load them in Next's precedence:
// .env.local first, since loadEnvFile never overwrites a variable already set.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations take a session connection (Supabase's session pooler); the app
    // itself runs through the transaction pooler in DATABASE_URL.
    url:
      process.env.DATABASE_MIGRATION_URL ||
      process.env.DATABASE_URL ||
      "postgres://localhost:5432/rho_receipts",
  },
});
