import IORedis from "ioredis";
import { loadEnv } from "@helpflow/config";

const env = loadEnv();

/** BullMQ requires maxRetriesPerRequest: null on the connection it manages. */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
