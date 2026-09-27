// GET /health · /ready — Section 12 Operations table. Liveness never touches a dependency;
// readiness checks the two dependencies the API cannot serve traffic without.
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import Redis from "ioredis";
import { prisma } from "@helpflow/database";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    const checks: Record<string, "ok" | "down"> = { database: "down", redis: "down" };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      // left as "down"
    }

    try {
      const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
      await redis.connect();
      await redis.ping();
      await redis.quit();
      checks.redis = "ok";
    } catch {
      // left as "down"
    }

    const allOk = Object.values(checks).every((v) => v === "ok");
    if (!allOk) {
      throw new ServiceUnavailableException({ status: "unavailable", checks });
    }
    return { status: "ok", checks };
  }
}
