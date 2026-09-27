import { join } from "node:path";
import { config } from "dotenv";

// Integration tests run from the package directory; .env lives at the repo root.
config({ path: join(__dirname, "..", "..", "..", ".env") });
