import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/player-identity.integration.test.ts"],
  },
});
