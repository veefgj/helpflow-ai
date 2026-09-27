import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.spec.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15_000,
  },
});
