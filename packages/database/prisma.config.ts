// HelpFlow AI — Prisma 7 configuration. Connection URL is read from DATABASE_URL (packages/config/env.ts
// validates it exists at process boot); it is repeated here only because Prisma CLI commands run outside
// the app's own bootstrap and need the same variable.
import path from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// pnpm runs this from packages/database, but .env lives at the repo root.
config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
