// Section 7 "Conversation state machine": every transition is one conditional UPDATE
// `WHERE id = ? AND organizationId = ? AND status = <from>`. Zero updated rows means the state
// changed first — callers turn that into 409 (CONVERSATION_ALREADY_ASSIGNED / INVALID_STATE_TRANSITION).
import { prisma } from "../client";
import type { CloseReason, Conversation, ConversationStatus, Language } from "../generated/prisma/client";

export interface TransitionFields {
  status: ConversationStatus;
  assignedAgentId?: string | null;
  assignedAt?: Date | null;
  handoffRequestedAt?: Date | null;
  closedAt?: Date | null;
  closeReason?: CloseReason | null;
}

/** Returns the updated row, or null if `from` no longer matched (someone else moved it first). */
export async function conditionalTransition(params: {
  conversationId: string;
  organizationId: string;
  from: ConversationStatus | ConversationStatus[];
  set: TransitionFields;
}): Promise<Conversation | null> {
  const fromStatuses = Array.isArray(params.from) ? params.from : [params.from];

  const result = await prisma.conversation.updateMany({
    where: { id: params.conversationId, organizationId: params.organizationId, status: { in: fromStatuses } },
    data: params.set,
  });

  if (result.count === 0) return null;
  return prisma.conversation.findUniqueOrThrow({ where: { id: params.conversationId } });
}

/** Section 5 "Language": the language for server-authored messages in this conversation. NULL only on
 * rows created before session language existed → the chatbot's default. Shared by the API and worker. */
export async function resolveConversationLanguage(conversation: Pick<Conversation, "language" | "chatbotId">): Promise<Language> {
  if (conversation.language) return conversation.language;
  const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: conversation.chatbotId }, select: { defaultLanguage: true } });
  return chatbot.defaultLanguage;
}
