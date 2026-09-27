import pino from "pino";
import { loadEnv } from "@helpflow/config";
import { startDocumentProcessingWorker } from "./queues/document-processing.worker";
import { startConversationTimersWorker } from "./queues/conversation-timers.worker";
import { startMaintenanceWorker } from "./queues/maintenance.worker";

const env = loadEnv(); // exits the process on invalid/missing config
const logger = pino({ level: env.LOG_LEVEL });

const workers = [startDocumentProcessingWorker(), startConversationTimersWorker(), startMaintenanceWorker()];

for (const worker of workers) {
  worker.on("ready", () => logger.info({ queue: worker.name }, "worker ready"));
  worker.on("failed", (job, err) => logger.error({ queue: worker.name, jobId: job?.id, err }, "job failed"));
}

async function shutdown() {
  logger.info("shutting down worker process");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("HelpFlow worker started");
