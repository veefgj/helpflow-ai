// Appendix B Q2 + Section 7 "Commit order": message inserts are serialized per conversation via
// SELECT ... FOR UPDATE on the conversation row, then INSERT, in one transaction — otherwise a
// later seq could commit before an earlier one and a client syncing on lastSeq would skip a row.
import { prisma } from "../client";
import type { MessageSenderType, MessageStreamStatus, Prisma } from "../generated/prisma/client";

export interface InsertMessageParams {
  /** Set explicitly for AI messages so the persisted row's id matches the streamId announced at
   * ai:started (Section 7 "AI streaming"). Omitted for customer/agent/system sends. */
  id?: string;
  organizationId: string;
  conversationId: string;
  clientMessageId?: string | null;
  senderType: MessageSenderType;
  senderId?: string | null;
  content: string;
  streamStatus?: MessageStreamStatus | null;
  citations?: unknown;
  insufficientKnowledge?: boolean;
  retrieval?: unknown;
}

/** Inserts a message, serialized per conversation. A duplicate clientMessageId returns the existing
 * row instead of erroring (Section 7 "Duplicate sends") — send retries stay idempotent. */
export async function insertMessageSerialized(params: InsertMessageParams) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM conversations WHERE id = ${params.conversationId} AND "organizationId" = ${params.organizationId} FOR UPDATE`;

    if (params.clientMessageId) {
      const existing = await tx.message.findUnique({
        where: { conversationId_clientMessageId: { conversationId: params.conversationId, clientMessageId: params.clientMessageId } },
      });
      if (existing) return existing;
    }

    const message = await tx.message.create({
      data: {
        id: params.id,
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        clientMessageId: params.clientMessageId ?? null,
        senderType: params.senderType,
        senderId: params.senderId ?? null,
        content: params.content,
        streamStatus: params.streamStatus ?? null,
        citations: (params.citations ?? undefined) as Prisma.InputJsonValue | undefined,
        insufficientKnowledge: params.insufficientKnowledge ?? false,
        retrieval: (params.retrieval ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await tx.conversation.update({ where: { id: params.conversationId }, data: { lastMessageAt: new Date() } });
    return message;
  });
}

export async function listMessagesAfterSeq(conversationId: string, afterSeq: bigint, limit: number) {
  return prisma.message.findMany({
    where: { conversationId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
    take: limit,
  });
}
