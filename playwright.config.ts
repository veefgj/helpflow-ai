// Section 13 Definition of Done: "widget question → grounded streamed answer with validated
// citation", exercised here through a real browser against the real API + widget dev servers.
// Precondition: `docker compose up -d` (Postgres/Redis/LocalStack) must already be running, the
// same precondition as any of the vitest integration suites — this only starts the two Node apps.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:4100",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @helpflow/api run dev",
      url: "http://localhost:4000/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // apps/widget has no root "/" page (only the dynamic /c/[chatbotId] route) — that 404s
      // forever, so the readiness check targets an actual route instead.
      command: "pnpm --filter @helpflow/widget run dev",
      url: "http://localhost:4100/c/readiness-check",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
