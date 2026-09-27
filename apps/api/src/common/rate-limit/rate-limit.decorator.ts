import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rateLimitConfig";

export interface RateLimitConfig {
  /** Redis key prefix, e.g. "auth" — combined with the client IP for the counter key. */
  keyPrefix: string;
  limit: number;
  windowSec: number;
  /** Section 10 "Failure handling": fails open for dashboard endpoints, closed for widget AI calls. */
  failOpen: boolean;
}

export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);
