// Section 7 "Timer implementation": BullMQ delayed jobs, deterministic job ids so a timer can be
// cancelled outright (accept before the handoff timer fires, reconnect before the grace period
// ends) instead of having to re-check state on every tick.
import { Inject, Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { CONVERSATION_TIMERS_QUEUE } from "../common/queues/queues.module";

@Injectable()
export class ConversationTimersQueueService {
  constructor(@Inject(CONVERSATION_TIMERS_QUEUE) private readonly queue: Queue) {}

  async scheduleHandoffTimeout(conversationId: string, delaySec: number): Promise<void> {
    const jobId = DEFAULTS.jobs.handoffTimeoutJobId(conversationId);
    await this.queue.add("handoff-timeout", { conversationId }, { jobId, delay: delaySec * 1000 });
  }

  async cancelHandoffTimeout(conversationId: string): Promise<void> {
    await this.queue.remove(DEFAULTS.jobs.handoffTimeoutJobId(conversationId));
  }

  async scheduleAgentGrace(conversationId: string, delaySec: number): Promise<void> {
    const jobId = DEFAULTS.jobs.agentGraceJobId(conversationId);
    await this.queue.add("agent-grace", { conversationId }, { jobId, delay: delaySec * 1000 });
  }

  async cancelAgentGrace(conversationId: string): Promise<void> {
    await this.queue.remove(DEFAULTS.jobs.agentGraceJobId(conversationId));
  }
}
