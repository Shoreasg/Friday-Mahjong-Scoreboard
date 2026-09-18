import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/*.integration.test.ts"],
    // Advisory locks are server-wide rather than schema-scoped, so suites
    // that each take PLAYER_WRITE_LOCK_KEY would interfere if run at once.
    fileParallelism: false,
  },
});
