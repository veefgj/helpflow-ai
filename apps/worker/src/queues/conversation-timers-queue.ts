// Mirrors apps/api/src/conversations/conversation-timers-queue.service.ts: T6 (agent-grace firing)
// needs to schedule a fresh handoff-timeout job from within the worker itself.
import { Queue } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { createRedisConnection } from "../redis";

const queue = new Queue(DEFAULTS.jobs.queues.conversationTimers, { connection: createRedisConnection() });

export async function scheduleHandoffTimeout(conversationId: string, delaySec: number): Promise<void> {
  const jobId = DEFAULTS.jobs.handoffTimeoutJobId(conversationId);
  await queue.add("handoff-timeout", { conversationId }, { jobId, delay: delaySec * 1000 });
}
