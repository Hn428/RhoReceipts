import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    env: {
      // Deterministic key so encryption tests do not depend on a developer's
      // local .env. Never used outside the test process.
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      REPORTING_TIME_ZONE: "America/New_York",
    },
  },
});
