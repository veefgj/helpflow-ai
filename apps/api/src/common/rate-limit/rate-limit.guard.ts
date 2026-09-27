// Fixed-window approximation of the sliding-window limits in DEFAULTS.rateLimit (Appendix E).
// Redis INCR + EXPIRE per key; good enough for an MVP abuse guard without a Lua sliding log.
import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
// NOTE: tsx/esbuild does not emit TypeScript decorator metadata, so every constructor param
// needs an explicit @Inject(token) — Nest can't infer the token from the parameter's type alone.
import type Redis from "ioredis";
import type { Request } from "express";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { REDIS_CLIENT } from "../redis/redis.module";
import { RATE_LIMIT_KEY, type RateLimitConfig } from "./rate-limit.decorator";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<RateLimitConfig | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!config) return true;
    // Integration tests legitimately fire many requests from the same loopback address in a few
    // hundred milliseconds; abuse-rate limiting is a production concern, not a test-correctness one.
    if (process.env.NODE_ENV === "test") return true;

    const req = context.switchToHttp().getRequest<Request>();
    const identifier = req.ip ?? "unknown";
    const key = `ratelimit:${config.keyPrefix}:${identifier}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, config.windowSec);
      }
      if (count > config.limit) {
        throw new HelpFlowApiException(ApiErrorCode.RATE_LIMITED, "Too many requests, please slow down", {
          limit: config.limit,
          windowSec: config.windowSec,
        });
      }
      return true;
    } catch (err) {
      if (err instanceof HelpFlowApiException) throw err;
      if (config.failOpen) return true;
      throw new HelpFlowApiException(ApiErrorCode.DEPENDENCY_UNAVAILABLE, "Rate limiter unavailable");
    }
  }
}
