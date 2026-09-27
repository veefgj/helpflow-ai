import type { Conversation } from "@helpflow/database";
import type { ConversationDto } from "@helpflow/types";

export function toConversationDto(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id,
    chatbotId: conversation.chatbotId,
    customerId: conversation.customerId,
    status: conversation.status,
    assignedAgentId: conversation.assignedAgentId,
    handoffRequestedAt: conversation.handoffRequestedAt?.toISOString() ?? null,
    closedAt: conversation.closedAt?.toISOString() ?? null,
    closeReason: conversation.closeReason,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
  };
}
