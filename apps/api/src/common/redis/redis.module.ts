import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { loadEnv } from "@helpflow/config";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
