import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.spec.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20_000,
  },
});
