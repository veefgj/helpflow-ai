// Processor implemented across Phases 2–4: release stale reservations, close inactive AI
// conversations (T9), purge two-phase document deletions. Scheduled every DEFAULTS.jobs.maintenanceEveryMin.
import { Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { createRedisConnection } from "../redis";

export function startMaintenanceWorker(): Worker {
  return new Worker(
    DEFAULTS.jobs.queues.maintenance,
    async (job) => {
      throw new Error(`maintenance not yet implemented (job ${job.id})`);
    },
    { connection: createRedisConnection() },
  );
}
