/**
 * Dev CLI for ingestion.
 *
 *   npm run sync            # incremental
 *   npm run sync -- --full  # ignore the watermark and re-read everything
 *
 * Deliberately a thin client over POST /api/sync rather than a direct import of
 * the sync function: the route is how ingestion runs in production (cron calls
 * it), so driving it here means dev and prod exercise identical code. It also
 * sidesteps module resolution — path aliases and extensionless imports are the
 * bundler's job, not bare Node's.
 *
 * Requires `npm run dev` to be running.
 */

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const fullRefresh = process.argv.includes("--full");

type SyncResult = {
  status: string;
  durationMs: number;
  windowStart: string | null;
  stats: Record<string, number>;
  error?: string;
};

let res: Response;
try {
  res = await fetch(`${baseUrl}/api/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ full_refresh: fullRefresh }),
  });
} catch {
  console.error(
    `Could not reach ${baseUrl}. Start the app first:\n\n  npm run dev\n`,
  );
  process.exit(1);
}

const result = (await res.json()) as SyncResult;

const width = Math.max(...Object.keys(result.stats ?? {}).map((k) => k.length));
console.log(`\nsync ${result.status} in ${result.durationMs}ms`);
console.log(
  `window: ${result.windowStart ?? "(full history)"}`,
);
for (const [key, value] of Object.entries(result.stats ?? {})) {
  console.log(`  ${key.padEnd(width)}  ${value}`);
}
if (result.error) console.error(`\nerror: ${result.error}`);
process.exit(result.status === "failed" ? 1 : 0);

export {};
