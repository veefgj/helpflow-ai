// Section 7 "Customer message while AI streams": one AI generation per conversation at a time.
import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../common/redis/redis.module";

@Injectable()
export class AiGenLockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(conversationId: string): string {
    return `aigen:${conversationId}`;
  }

  async isLocked(conversationId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(conversationId))) === 1;
  }

  /** Safety TTL in case a crashed process never releases the lock. */
  async acquire(conversationId: string): Promise<boolean> {
    const result = await this.redis.set(this.key(conversationId), "1", "EX", 60, "NX");
    return result === "OK";
  }

  async release(conversationId: string): Promise<void> {
    await this.redis.del(this.key(conversationId));
  }
}
