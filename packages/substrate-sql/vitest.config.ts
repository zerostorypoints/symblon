import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 60_000, // Testcontainers / DB round-trips
    hookTimeout: 120_000, // pulling the Postgres image on first run
    // Run test files sequentially: in CI both files share one Postgres
    // (SYMBLON_TEST_DATABASE_URL), so parallel `truncate`s would interfere.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@symblon/core": fileURLToPath(new URL("../../index.ts", import.meta.url)),
    },
  },
});
