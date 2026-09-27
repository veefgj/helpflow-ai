import { Global, Module } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { DEFAULTS, loadEnv } from "@helpflow/config";

export const DOCUMENT_PROCESSING_QUEUE = Symbol("DOCUMENT_PROCESSING_QUEUE");
export const CONVERSATION_TIMERS_QUEUE = Symbol("CONVERSATION_TIMERS_QUEUE");

@Global()
@Module({
  providers: [
    {
      provide: DOCUMENT_PROCESSING_QUEUE,
      useFactory: () =>
        new Queue(DEFAULTS.jobs.queues.documentProcessing, {
          connection: new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null }),
        }),
    },
    {
      provide: CONVERSATION_TIMERS_QUEUE,
      useFactory: () =>
        new Queue(DEFAULTS.jobs.queues.conversationTimers, {
          connection: new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null }),
        }),
    },
  ],
  exports: [DOCUMENT_PROCESSING_QUEUE, CONVERSATION_TIMERS_QUEUE],
})
export class QueuesModule {}
