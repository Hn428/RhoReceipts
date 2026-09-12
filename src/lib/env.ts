/**
 * Validated environment.
 *
 * Parsed once, at import. A missing ENCRYPTION_KEY should stop the process at
 * boot with a message naming the variable — not surface three screens later as
 * a decrypt failure while someone is connecting their bank account.
 *
 * Only `NEXT_PUBLIC_*` values may be read on the client; everything here is
 * server-side, so this module must never be imported from a client component.
 */

import { z } from "zod";

const base64Bytes = (bytes: number) =>
  z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === bytes, {
      message: `must be base64 decoding to exactly ${bytes} bytes`,
    });

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /** Unset means embedded PGlite in PGLITE_DIR. */
  DATABASE_URL: z.string().url().optional(),
  /** Defaults to ~/.cache/rho-receipts/pglite — deliberately outside any synced folder. */
  PGLITE_DIR: z.string().optional(),

  RHO_API_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:3000/api/mock/rho/v1"),
  RHO_API_TOKEN: z
    .string()
    .startsWith("rhobat_", { message: 'must start with "rhobat_"' })
    .optional(),
  RHO_MOCK_TOKEN: z.string().optional(),

  ENCRYPTION_KEY: base64Bytes(32),
  AUTH_SECRET: z.string().min(16),

  REPORTING_TIME_ZONE: z
    .string()
    .default("America/New_York")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, { message: "must be a valid IANA timezone" }),

  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }
  return result.data;
}

let cached: Env | null = null;

/**
 * Lazy rather than module-level so that importing a module which happens to
 * touch env does not crash tooling that legitimately runs without a full
 * environment (migrations generation, type checking).
 */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}
