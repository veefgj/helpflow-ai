import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.spec.ts"],
    environment: "node",
    testTimeout: 20_000,
    setupFiles: ["./test/setup.ts"],
    // Auth/org integration tests share one real Postgres+Redis; run them one file at a time to
    // avoid cross-test data races on the same tables.
    fileParallelism: false,
  },
});
