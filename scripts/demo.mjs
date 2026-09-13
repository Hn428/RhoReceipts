import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { spawn, spawnSync } from "node:child_process";

// An isolated database and persistent demo-only keys leave the developer's data alone.
mkdirSync(".demo", { recursive: true });
const credentialsPath = ".demo/credentials.json";
if (!existsSync(credentialsPath)) writeFileSync(credentialsPath, JSON.stringify({
  ENCRYPTION_KEY: randomBytes(32).toString("base64"), AUTH_SECRET: randomBytes(32).toString("base64"),
}), { mode: 0o600 });
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const port = process.env.DEMO_PORT ?? "3000";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid DEMO_PORT");
// Next reads .env files itself, but the seed step is plain Node: pass the Tavily key through.
const fileEnv = Object.assign({}, ...[".env", ".env.local"].filter((file) => existsSync(file)).map((file) => parseEnv(readFileSync(file, "utf8"))));
const demoEnv = { ...process.env, ...credentials, DATABASE_URL: "", TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? fileEnv.TAVILY_API_KEY ?? "",
  PGLITE_DIR: resolve(".demo/pglite"), APP_URL: `http://127.0.0.1:${port}`,
  REPORTING_TIME_ZONE: "America/New_York", NODE_ENV: "development" };
// An empty override keeps Next off a real database from .env files. A Tavily key is kept:
// the demo checks its real vendors live, while fictional customers stay simulated.
const seeded = spawnSync(process.execPath, ["--conditions=react-server", "--import=tsx", "scripts/demo-seed.ts"], { env: demoEnv, stdio: "inherit" });
if (seeded.status !== 0) process.exit(seeded.status ?? 1);
if (!process.argv.includes("--seed-only")) {
  console.log(`Open ${demoEnv.APP_URL}. Founder and investor sign-in links print here. Ctrl+C stops the demo.`);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], { env: demoEnv, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 0));
}
