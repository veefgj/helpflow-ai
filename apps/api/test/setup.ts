import { join } from "node:path";
import { config } from "dotenv";

// Integration tests run from apps/api; .env lives at the repo root.
config({ path: join(__dirname, "..", "..", "..", ".env") });
