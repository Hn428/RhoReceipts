import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
const demoEnv = { ...process.env, ...credentials, DATABASE_URL: "", TAVILY_API_KEY: "",
  PGLITE_DIR: resolve(".demo/pglite"), APP_URL: `http://127.0.0.1:${port}`,
  REPORTING_TIME_ZONE: "America/New_York", NODE_ENV: "development" };
// Empty overrides prevent Next from loading a real database or research key from .env.local.
const seeded = spawnSync(process.execPath, ["--conditions=react-server", "--import=tsx", "scripts/demo-seed.ts"], { env: demoEnv, stdio: "inherit" });
if (seeded.status !== 0) process.exit(seeded.status ?? 1);
if (!process.argv.includes("--seed-only")) {
  console.log(`Open ${demoEnv.APP_URL}/discover. Founder sign-in links print here. Ctrl+C stops the demo.`);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], { env: demoEnv, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 0));
}
