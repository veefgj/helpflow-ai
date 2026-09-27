import { join } from "node:path";
import { config } from "dotenv";

// Integration tests run from apps/worker; .env lives at the repo root.
config({ path: join(__dirname, "..", "..", "..", ".env") });
