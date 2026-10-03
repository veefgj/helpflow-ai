import type { Conversation, Message } from "@helpflow/database";
import type { ConversationDto, MessageDto } from "@helpflow/types";

export function toConversationDto(c: Conversation): ConversationDto {
  return {
    id: c.id,
    chatbotId: c.chatbotId,
    customerId: c.customerId,
    status: c.status,
    assignedAgentId: c.assignedAgentId,
    handoffRequestedAt: c.handoffRequestedAt?.toISOString() ?? null,
    closedAt: c.closedAt?.toISOString() ?? null,
    closeReason: c.closeReason,
    language: c.language,
    lastMessageAt: c.lastMessageAt.toISOString(),
  };
}

export function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq.toString(),
    clientMessageId: m.clientMessageId,
    senderType: m.senderType,
    senderId: m.senderId,
    content: m.content,
    streamStatus: m.streamStatus,
    citations: null,
    createdAt: m.createdAt.toISOString(),
  };
}
