// HelpFlow AI — environment schema. Validated once at process boot; the process exits on a missing
// or invalid variable (see loadEnv() below). Never read process.env directly outside this module.

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  WIDGET_ORIGIN: z.string().url(),

  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),

  REDIS_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  VISITOR_TOKEN_SECRET: z.string().min(32),
  REFRESH_COOKIE_SECRET: z.string().min(32),

  OPENAI_API_KEY: z.string().min(1),
  /** Leave unset to call api.openai.com directly. Set to point the OpenAI SDK at an
   * OpenAI-compatible third-party relay instead (e.g. https://api.vilao.ai/v1), using the same
   * OPENAI_API_KEY/LLM_CHAT_MODEL/EMBEDDING_MODEL — no separate provider implementation needed
   * since the wire format is identical. */
  OPENAI_BASE_URL: z.string().url().optional(),
  /** "fake" runs the deterministic in-process stub instead of calling OpenAI — no key needed
   * (Section 10 "E2E ... with a stubbed LLM provider (deterministic stream)"). */
  AI_PROVIDER: z.enum(["openai", "fake"]).default("openai"),
  LLM_CHAT_MODEL: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID_PRO: z.string().min(1),

  SENTRY_DSN: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parses process.env once. Throws (and the caller should let the process exit) on any invalid value. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    console.error("Invalid environment configuration:\n" + result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  cached = result.data;
  return cached;
}
