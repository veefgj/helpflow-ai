import type { Message } from "@helpflow/database";
import type { Citation, MessageDto } from "@helpflow/types";

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    seq: message.seq.toString(),
    clientMessageId: message.clientMessageId,
    senderType: message.senderType,
    senderId: message.senderId,
    content: message.content,
    streamStatus: message.streamStatus,
    citations: (message.citations as unknown as Citation[] | null) ?? null,
    ...(message.senderType === "AI" ? { insufficientKnowledge: message.insufficientKnowledge } : {}),
    createdAt: message.createdAt.toISOString(),
  };
}
