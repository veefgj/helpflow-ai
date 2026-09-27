// HelpFlow AI — CI/CD "Main" stage (Section 11): prisma migrate deploy, then the raw SQL migration
// (Appendix B), then a pgvector version gate. Exits non-zero on any failure so the pipeline stops
// before the new API version starts.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: join(__dirname, "..", "..", "..", ".env") });

const RAW_SQL_ALREADY_EXISTS = new Set(["42710", "42P07", "42P16"]); // duplicate_object, duplicate_table, invalid_table_definition

async function applyRawConstraints(client: Client): Promise<void> {
  const sqlPath = join(__dirname, "..", "sql", "0002_raw_constraints.sql");
  const sql = readFileSync(sqlPath, "utf-8");
  // Strip full-line comments first, then split on statement-terminating semicolons — a naive split
  // on ";" alone would also break on the commented-out reference queries below the real DDL.
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    try {
      await client.query(statement);
      console.log(`  ✓ ${statement.split("\n")[0]?.slice(0, 80)}`);
    } catch (err: any) {
      if (RAW_SQL_ALREADY_EXISTS.has(err?.code)) {
        console.log(`  · already applied: ${statement.split("\n")[0]?.slice(0, 80)}`);
        continue;
      }
      throw err;
    }
  }
}

async function checkPgVector(client: Client): Promise<void> {
  const { rows } = await client.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  const version = rows[0]?.extversion;
  if (!version) {
    throw new Error("pgvector extension is not installed (CREATE EXTENSION vector).");
  }
  const [major, minor] = version.split(".").map(Number);
  const meetsMinimum = major! > 0 || (major === 0 && minor! >= 8);
  if (!meetsMinimum) {
    throw new Error(`pgvector ${version} is older than the required 0.8.0.`);
  }
  console.log(`  ✓ pgvector ${version} >= 0.8.0`);
}

async function main() {
  console.log("→ prisma migrate deploy");
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", cwd: join(__dirname, "..") });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log("→ CREATE EXTENSION vector (if not present)");
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");

    console.log("→ applying raw SQL constraints (0002_raw_constraints.sql)");
    await applyRawConstraints(client);

    console.log("→ checking pgvector version");
    await checkPgVector(client);
  } finally {
    await client.end();
  }

  console.log("✓ migrations applied");
}

main().catch((err) => {
  console.error("✗ migrate-deploy failed:", err);
  process.exit(1);
});
