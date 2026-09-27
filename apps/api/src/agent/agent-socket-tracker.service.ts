// Section 7 "Agent disconnect": scheduling/cancelling the grace timer is driven by the agent's
// LAST socket closing (or their first socket reconnecting), tracked as a per-user count in Redis —
// not by any single socket's disconnect event, since a staff member may have several tabs open.
import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../common/redis/redis.module";

@Injectable()
export class AgentSocketTrackerService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(userId: string): string {
    return `agent-sockets:${userId}`;
  }

  /** Returns true the moment this user's socket count goes from 0 to 1 (they just came online). */
  async connect(userId: string): Promise<boolean> {
    const count = await this.redis.incr(this.key(userId));
    return count === 1;
  }

  /** Returns true the moment this user's socket count reaches 0 (their last socket just closed). */
  async disconnect(userId: string): Promise<boolean> {
    const count = await this.redis.decr(this.key(userId));
    if (count <= 0) {
      await this.redis.del(this.key(userId));
      return true;
    }
    return false;
  }
}
