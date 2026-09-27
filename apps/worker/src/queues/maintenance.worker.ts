// Section 4 "Delete document": retries the two-phase purge (chunks → object → row) for documents
// whose deletedAt is set but that failed to fully purge when the API first attempted it.
// Phase 3/4 add more sweeps here (stale reservations, T9 inactivity close) alongside this one.
import { Queue, Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { prisma } from "@helpflow/database";
import { deleteObject } from "@helpflow/storage";
import { createRedisConnection } from "../redis";

async function purgeSoftDeletedDocuments(): Promise<void> {
  const pending = await prisma.document.findMany({ where: { deletedAt: { not: null } } });
  for (const doc of pending) {
    try {
      await prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });
      await deleteObject(doc.storageKey);
      await prisma.document.delete({ where: { id: doc.id } });
    } catch (err) {
      console.error(`maintenance: failed to purge document ${doc.id}, will retry next sweep`, err);
    }
  }
}

export function startMaintenanceWorker(): Worker {
  const connection = createRedisConnection();

  const queue = new Queue(DEFAULTS.jobs.queues.maintenance, { connection });
  void queue.add(
    "sweep",
    {},
    { repeat: { every: DEFAULTS.jobs.maintenanceEveryMin * 60_000 }, jobId: "maintenance-sweep" },
  );

  return new Worker(
    DEFAULTS.jobs.queues.maintenance,
    async () => {
      await purgeSoftDeletedDocuments();
    },
    { connection },
  );
}
