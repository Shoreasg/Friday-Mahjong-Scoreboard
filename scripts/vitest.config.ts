import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real-Postgres coverage lives in *.integration.test.ts and needs a
    // live database (see package.json's "test:integration" script). It's
    // excluded from the default mocked suite so `pnpm test` never requires
    // Postgres to be running.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
