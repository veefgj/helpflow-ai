// Section 7 T2 (customer-initiated handoff) and the post-T5 contact form.
import { Inject, Injectable } from "@nestjs/common";
import { prisma, conditionalTransition, insertMessageSerialized, type Conversation } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { RealtimeEmitterService } from "../common/realtime/realtime-emitter.service";
import { AiReplyService } from "../ai-reply/ai-reply.service";
import { ConversationTimersQueueService } from "../conversations/conversation-timers-queue.service";
import type { VisitorTokenPayload } from "./visitor-token";

@Injectable()
export class WidgetConversationsService {
  constructor(
    @Inject(RealtimeEmitterService) private readonly realtime: RealtimeEmitterService,
    @Inject(AiReplyService) private readonly aiReply: AiReplyService,
    @Inject(ConversationTimersQueueService) private readonly timers: ConversationTimersQueueService,
  ) {}

  /** T2: customer asks for a human. Cancels any in-flight AI stream and starts the handoff-timeout clock. */
  async requestHandoff(visitor: VisitorTokenPayload, conversationId: string): Promise<Conversation> {
    const current = await this.requireOwnConversation(visitor, conversationId);
    if (current.status !== "AI_ACTIVE") {
      throw new HelpFlowApiException(ApiErrorCode.INVALID_STATE_TRANSITION, "Handoff can only be requested while the AI is active", {
        currentStatus: current.status,
      });
    }

    const updated = await conditionalTransition({
      conversationId,
      organizationId: visitor.organizationId,
      from: "AI_ACTIVE",
      set: { status: "WAITING_AGENT", handoffRequestedAt: new Date() },
    });
    if (!updated) {
      const latest = await prisma.conversation.findUnique({ where: { id: conversationId } });
      throw new HelpFlowApiException(ApiErrorCode.INVALID_STATE_TRANSITION, "Conversation state changed before handoff completed", {
        currentState: latest ? toConversationDto(latest) : null,
      });
    }

    this.aiReply.abort(conversationId); // no-op if nothing was in flight; the stream persists as INTERRUPTED

    const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: visitor.chatbotId } });
    await this.timers.scheduleHandoffTimeout(conversationId, chatbot.handoffTimeoutSec ?? DEFAULTS.handoff.waitingTimeoutSec);

    await this.emitTransition(updated, "The customer asked to speak with a human. Waiting for an agent.");
    return updated;
  }

  /** After T5 (COLLECT_EMAIL close): the widget shows an email form so staff can follow up later. */
  async saveContact(visitor: VisitorTokenPayload, conversationId: string, email: string, name?: string): Promise<void> {
    const current = await this.requireOwnConversation(visitor, conversationId);
    if (current.status !== "CLOSED" || current.closeReason !== "AGENT_UNAVAILABLE") {
      throw new HelpFlowApiException(ApiErrorCode.INVALID_STATE_TRANSITION, "Contact info can only be left after the conversation closed for agent unavailability");
    }
    await prisma.customer.update({ where: { id: visitor.customerId }, data: { email, ...(name ? { name } : {}) } });
  }

  private async requireOwnConversation(visitor: VisitorTokenPayload, conversationId: string): Promise<Conversation> {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.organizationId !== visitor.organizationId || conversation.customerId !== visitor.customerId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Conversation not found");
    }
    return conversation;
  }

  private async emitTransition(conversation: Conversation, systemMessageText: string): Promise<void> {
    const message = await insertMessageSerialized({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      senderType: "SYSTEM",
      content: systemMessageText,
    });
    this.realtime.emitToConversation(conversation.id, "message:created", toMessageDto(message));
    const dto = toConversationDto(conversation);
    this.realtime.emitToConversation(conversation.id, "conversation:updated", dto);
    this.realtime.emitInboxUpdated(conversation.organizationId, { conversation: dto });
  }
}
