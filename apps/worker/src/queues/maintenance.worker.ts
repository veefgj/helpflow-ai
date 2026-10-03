// Two sweeps: Section 4 "Delete document" retries the two-phase purge (chunks → object → row) for
// documents whose deletedAt is set but that failed to fully purge when the API first attempted it;
// Section 7 T9 closes AI_ACTIVE conversations that have had no messages for aiInactivityCloseHours.
// Phase 4 adds a third sweep here (releasing stale token reservations).
import { Queue, Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { prisma, conditionalTransition, insertMessageSerialized, releaseStaleReservations, resolveConversationLanguage } from "@helpflow/database";
import { t } from "@helpflow/types";
import { deleteObject } from "@helpflow/storage";
import { createRedisConnection } from "../redis";
import { emitConversationUpdated, emitInboxUpdated, emitMessageCreated } from "../realtime";
import { toConversationDto, toMessageDto } from "../mappers";

/** Section 8: a reservation whose caller crashed before reconcile/release stays RESERVED forever
 * otherwise, permanently shrinking the org's available quota. */
export async function sweepStaleTokenReservations(): Promise<void> {
  const cutoff = new Date(Date.now() - DEFAULTS.quota.reservationStaleMin * 60_000);
  const released = await releaseStaleReservations(cutoff);
  if (released > 0) console.log(`maintenance: released ${released} stale token reservation(s)`);
}

export async function purgeSoftDeletedDocuments(): Promise<void> {
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

/** T9: an AI_ACTIVE conversation with no activity for aiInactivityCloseHours is closed. */
export async function closeInactiveAiConversations(): Promise<void> {
  const cutoff = new Date(Date.now() - DEFAULTS.conversation.aiInactivityCloseHours * 60 * 60 * 1000);
  const stale = await prisma.conversation.findMany({ where: { status: "AI_ACTIVE", lastMessageAt: { lt: cutoff } } });

  for (const conversation of stale) {
    const updated = await conditionalTransition({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      from: "AI_ACTIVE",
      set: { status: "CLOSED", closedAt: new Date(), closeReason: "INACTIVITY" },
    });
    if (!updated) continue;

    const message = await insertMessageSerialized({
      organizationId: updated.organizationId,
      conversationId: updated.id,
      senderType: "SYSTEM",
      content: t(await resolveConversationLanguage(updated), "inactivityClosed"),
    });
    emitMessageCreated(updated.id, toMessageDto(message));
    const dto = toConversationDto(updated);
    emitConversationUpdated(dto);
    emitInboxUpdated(updated.organizationId, { conversation: dto });
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
      await closeInactiveAiConversations();
      await sweepStaleTokenReservations();
    },
    { connection },
  );
}
