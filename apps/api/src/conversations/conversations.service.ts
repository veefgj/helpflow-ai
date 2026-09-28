// Section 7 "Conversation state machine" — the REST-triggered transitions (T3 accept, T3/T7
// takeover, T7 reassign, T6 release, T8 close). T2/T4/T5/T9 live in widget.controller.ts and the
// worker's conversation-timers processor.
import { Inject, Injectable } from "@nestjs/common";
import {
  prisma,
  conditionalTransition,
  insertMessageSerialized,
  listMessagesAfterSeq,
  type Conversation,
  type Membership,
  type Prisma,
} from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { RealtimeEmitterService } from "../common/realtime/realtime-emitter.service";
import { ConversationTimersQueueService } from "./conversation-timers-queue.service";

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(RealtimeEmitterService) private readonly realtime: RealtimeEmitterService,
    @Inject(ConversationTimersQueueService) private readonly timers: ConversationTimersQueueService,
  ) {}

  async list(organizationId: string, filters: { status?: string; assignedToMe?: string }) {
    const rows = await prisma.conversation.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status as Conversation["status"] } : {}),
        ...(filters.assignedToMe ? { assignedAgentId: filters.assignedToMe } : {}),
      },
      include: { customer: { select: { name: true, email: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    return rows.map((r) => ({ ...r, customerName: r.customer.name, customerEmail: r.customer.email, customer: undefined }));
  }

  async get(organizationId: string, conversationId: string) {
    return this.requireConversation(organizationId, conversationId);
  }

  async messages(organizationId: string, conversationId: string, afterSeq: bigint, limit: number): ReturnType<typeof listMessagesAfterSeq> {
    await this.requireConversation(organizationId, conversationId);
    return listMessagesAfterSeq(conversationId, afterSeq, limit);
  }

  async customerConversations(organizationId: string, customerId: string) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Customer not found");
    }
    return prisma.conversation.findMany({ where: { organizationId, customerId }, orderBy: { createdAt: "desc" } });
  }

  /** T3: an agent accepts an unassigned waiting conversation. */
  async accept(organizationId: string, conversationId: string, agentUserId: string): Promise<Conversation> {
    const updated = await conditionalTransition({
      conversationId,
      organizationId,
      from: "WAITING_AGENT",
      set: { status: "AGENT_ACTIVE", assignedAgentId: agentUserId, assignedAt: new Date() },
    });
    if (!updated) return this.conflict(organizationId, conversationId, ApiErrorCode.CONVERSATION_ALREADY_ASSIGNED);

    await this.timers.cancelHandoffTimeout(conversationId);
    await this.transitionSideEffects(updated, "An agent has joined the conversation.");
    return updated;
  }

  /** T3 (to self, from WAITING_AGENT) or T7 (to self, from AGENT_ACTIVE) — Owner/Admin override. */
  async takeover(organizationId: string, conversationId: string, actorUserId: string): Promise<Conversation> {
    const current = await this.requireConversation(organizationId, conversationId);

    if (current.status === "WAITING_AGENT") {
      const updated = await conditionalTransition({
        conversationId,
        organizationId,
        from: "WAITING_AGENT",
        set: { status: "AGENT_ACTIVE", assignedAgentId: actorUserId, assignedAt: new Date() },
      });
      if (!updated) return this.conflict(organizationId, conversationId, ApiErrorCode.CONVERSATION_ALREADY_ASSIGNED);
      await this.timers.cancelHandoffTimeout(conversationId);
      await this.transitionSideEffects(updated, "An agent has taken over the conversation.");
      return updated;
    }

    if (current.status === "AGENT_ACTIVE") {
      const updated = await conditionalTransition({
        conversationId,
        organizationId,
        from: "AGENT_ACTIVE",
        set: { status: "AGENT_ACTIVE", assignedAgentId: actorUserId, assignedAt: new Date() },
      });
      if (!updated) return this.conflict(organizationId, conversationId, ApiErrorCode.CONVERSATION_ALREADY_ASSIGNED);
      await this.writeAudit(organizationId, actorUserId, "conversation.takeover", conversationId);
      await this.transitionSideEffects(updated, "An agent has taken over the conversation.");
      return updated;
    }

    throw new HelpFlowApiException(ApiErrorCode.INVALID_STATE_TRANSITION, "Conversation cannot be taken over in its current state", {
      currentStatus: current.status,
    });
  }

  /** T7: Owner/Admin reassigns an AGENT_ACTIVE conversation to a specific, active member. */
  async reassign(organizationId: string, conversationId: string, actorUserId: string, targetAgentUserId: string): Promise<Conversation> {
    const targetMembership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetAgentUserId } },
    });
    if (!targetMembership || targetMembership.disabledReason) {
      throw new HelpFlowApiException(ApiErrorCode.VALIDATION_ERROR, "Target is not an active member of this organization");
    }

    const updated = await conditionalTransition({
      conversationId,
      organizationId,
      from: "AGENT_ACTIVE",
      set: { status: "AGENT_ACTIVE", assignedAgentId: targetAgentUserId, assignedAt: new Date() },
    });
    if (!updated) return this.conflict(organizationId, conversationId, ApiErrorCode.INVALID_STATE_TRANSITION);

    await this.writeAudit(organizationId, actorUserId, "conversation.reassigned", conversationId, { targetAgentUserId });
    await this.transitionSideEffects(updated, "The conversation was reassigned to another agent.");
    return updated;
  }

  /** T6: the assigned agent (or Owner/Admin) manually releases the conversation back to the queue. */
  async release(organizationId: string, conversationId: string, actor: Membership, actorUserId: string): Promise<Conversation> {
    const current = await this.requireConversation(organizationId, conversationId);
    this.requireAssignedOrPrivileged(current, actor, actorUserId);

    const updated = await conditionalTransition({
      conversationId,
      organizationId,
      from: "AGENT_ACTIVE",
      set: { status: "WAITING_AGENT", assignedAgentId: null, assignedAt: null, handoffRequestedAt: new Date() },
    });
    if (!updated) return this.conflict(organizationId, conversationId, ApiErrorCode.INVALID_STATE_TRANSITION);

    await this.timers.cancelAgentGrace(conversationId);
    await this.timers.scheduleHandoffTimeout(conversationId, DEFAULTS.handoff.waitingTimeoutSec);
    await this.transitionSideEffects(updated, "The agent released the conversation; waiting for another agent.");
    return updated;
  }

  /** T8: the assigned agent (or Owner/Admin) closes the conversation. */
  async close(organizationId: string, conversationId: string, actor: Membership, actorUserId: string): Promise<Conversation> {
    const current = await this.requireConversation(organizationId, conversationId);
    this.requireAssignedOrPrivileged(current, actor, actorUserId);

    const updated = await conditionalTransition({
      conversationId,
      organizationId,
      from: "AGENT_ACTIVE",
      set: { status: "CLOSED", assignedAgentId: null, assignedAt: null, closedAt: new Date(), closeReason: "CLOSED_BY_AGENT" },
    });
    if (!updated) return this.conflict(organizationId, conversationId, ApiErrorCode.INVALID_STATE_TRANSITION);

    await this.timers.cancelAgentGrace(conversationId);
    await this.transitionSideEffects(updated, "The agent closed the conversation.");
    return updated;
  }

  private requireAssignedOrPrivileged(conversation: Conversation, actor: Membership, actorUserId: string): void {
    if (actor.role === "AGENT" && conversation.assignedAgentId !== actorUserId) {
      throw new HelpFlowApiException(ApiErrorCode.FORBIDDEN, "Only the assigned agent (or an Owner/Admin) may do this");
    }
  }

  private async requireConversation(organizationId: string, conversationId: string): Promise<Conversation> {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Conversation not found");
    }
    return conversation;
  }

  private async conflict(organizationId: string, conversationId: string, code: typeof ApiErrorCode.CONVERSATION_ALREADY_ASSIGNED | typeof ApiErrorCode.INVALID_STATE_TRANSITION): Promise<never> {
    const current = await prisma.conversation.findUnique({ where: { id: conversationId } });
    throw new HelpFlowApiException(code, "The conversation's state changed before this request completed", {
      currentState: current ? toConversationDto(current) : null,
    });
  }

  private async writeAudit(organizationId: string, actorId: string, action: string, entityId: string, metadata?: Record<string, unknown>): Promise<void> {
    await prisma.auditLog.create({
      data: { organizationId, actorId, action, entityType: "conversation", entityId, metadata: metadata as Prisma.InputJsonValue | undefined },
    });
  }

  /** Every successful transition inserts a SYSTEM message and emits conversation:updated + inbox:updated. */
  private async transitionSideEffects(conversation: Conversation, systemMessageText: string): Promise<void> {
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
