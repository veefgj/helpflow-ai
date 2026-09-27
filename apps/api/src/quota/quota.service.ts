// Section 8 "Usage quota & billing" + Section 4 "Disabled resources": plan limits, the current
// quota period (Stripe period for paid plans, anchored monthly for FREE), and the reservation
// wrapper the AI reply pipeline uses. Resource-count limits (chatbots/documents/agents) are
// separate from token reservation — they gate creation, not generation.
import { Injectable } from "@nestjs/common";
import { prisma, reserveTokens, reconcileReservation, releaseReservation, type ReserveTokensResult } from "@helpflow/database";
import { anchoredMonthlyPeriod } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";

export interface PlanLimits {
  maxChatbots: number | null;
  maxAgents: number | null;
  maxDocuments: number | null;
  monthlyAiTokens: number | null;
  monthlyConversations: number | null;
}

@Injectable()
export class QuotaService {
  async getPlanLimits(organizationId: string): Promise<PlanLimits> {
    const subscription = await prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    if (!subscription) {
      // Should not happen (every org gets a FREE subscription at creation) — fail safe to FREE-like limits.
      return { maxChatbots: 1, maxAgents: 1, maxDocuments: 5, monthlyAiTokens: 50_000, monthlyConversations: 100 };
    }
    return {
      maxChatbots: subscription.plan.maxChatbots,
      maxAgents: subscription.plan.maxAgents,
      maxDocuments: subscription.plan.maxDocuments,
      monthlyAiTokens: subscription.plan.monthlyAiTokens,
      monthlyConversations: subscription.plan.monthlyConversations,
    };
  }

  async getCurrentPeriod(organizationId: string): Promise<{ periodStart: Date; periodEnd: Date }> {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { subscription: true } });
    if (org.subscription?.stripeSubscriptionId) {
      return { periodStart: org.subscription.currentPeriodStart, periodEnd: org.subscription.currentPeriodEnd };
    }
    return anchoredMonthlyPeriod(org.quotaAnchorAt);
  }

  async reserveAiTokens(params: { organizationId: string; chatbotId: string; conversationId: string; estimatedTokens: number; dailyCap: number }): Promise<ReserveTokensResult> {
    const [{ monthlyAiTokens }, period] = await Promise.all([this.getPlanLimits(params.organizationId), this.getCurrentPeriod(params.organizationId)]);
    return reserveTokens({
      organizationId: params.organizationId,
      chatbotId: params.chatbotId,
      conversationId: params.conversationId,
      estimatedTokens: params.estimatedTokens,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      monthlyLimit: monthlyAiTokens,
      dailyCap: params.dailyCap,
    });
  }

  async reconcile(reservationId: string, actualTokens: number): Promise<void> {
    await reconcileReservation(reservationId, actualTokens);
  }

  async release(reservationId: string): Promise<void> {
    await releaseReservation(reservationId);
  }

  /** T1: increments conversations/month once per created conversation; throws 402 if the plan's
   * monthly conversation limit is already reached. */
  async checkAndReserveConversation(organizationId: string): Promise<void> {
    const [{ monthlyConversations }, period] = await Promise.all([this.getPlanLimits(organizationId), this.getCurrentPeriod(organizationId)]);
    if (monthlyConversations === null) return; // unlimited (BUSINESS)

    const counter = await prisma.usageCounter.upsert({
      where: { organizationId_periodStart: { organizationId, periodStart: period.periodStart } },
      create: { organizationId, periodStart: period.periodStart, periodEnd: period.periodEnd },
      update: {},
    });
    const updated = await prisma.usageCounter.updateMany({
      where: { id: counter.id, conversationsCount: { lt: monthlyConversations } },
      data: { conversationsCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new HelpFlowApiException(ApiErrorCode.QUOTA_EXCEEDED, "Monthly conversation limit reached for this plan", {
        limit: monthlyConversations,
      });
    }
  }

  /** Chatbot/document/agent creation over the plan limit (Section 8 "Over the limit"). */
  async assertResourceLimit(organizationId: string, resource: "chatbots" | "documents" | "agents"): Promise<void> {
    const limits = await this.getPlanLimits(organizationId);
    const limit = resource === "chatbots" ? limits.maxChatbots : resource === "documents" ? limits.maxDocuments : limits.maxAgents;
    if (limit === null) return; // unlimited

    const count =
      resource === "chatbots"
        ? await prisma.chatbot.count({ where: { organizationId, disabledReason: null } })
        : resource === "documents"
          ? await prisma.document.count({ where: { organizationId, disabledReason: null, deletedAt: null } })
          : await prisma.membership.count({ where: { organizationId, disabledReason: null } });

    if (count >= limit) {
      throw new HelpFlowApiException(ApiErrorCode.PLAN_LIMIT_EXCEEDED, `This plan allows at most ${limit} ${resource}`, { limit, resource });
    }
  }
}
