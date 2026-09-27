// Processor implemented in Phase 3 (Section 7): handoff-timeout:{id} and agent-grace:{id} jobs.
// Each job re-checks conversation state with a conditional UPDATE, so a stale timer is harmless.
import { Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { createRedisConnection } from "../redis";

export function startConversationTimersWorker(): Worker {
  return new Worker(
    DEFAULTS.jobs.queues.conversationTimers,
    async (job) => {
      throw new Error(`conversation-timers not yet implemented (job ${job.id})`);
    },
    { connection: createRedisConnection() },
  );
}
