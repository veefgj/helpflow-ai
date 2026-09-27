// Processor implemented in Phase 2 (Section 5 "Document ingestion"): parse → chunk → embed → persist.
import { Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { createRedisConnection } from "../redis";

export function startDocumentProcessingWorker(): Worker {
  return new Worker(
    DEFAULTS.jobs.queues.documentProcessing,
    async (job) => {
      throw new Error(`document-processing not yet implemented (job ${job.id})`);
    },
    { connection: createRedisConnection() },
  );
}
