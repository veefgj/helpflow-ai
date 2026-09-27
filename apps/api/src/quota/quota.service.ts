// Section 8 "Usage quota & billing" + Section 4 "Disabled resources": plan limits, the current
// quota period (Stripe period for paid plans, anchored monthly for FREE), and the reservation
// wrapper the AI reply pipeline uses. Resource-count limits (chatbots/documents/agents) are
// separate from token reservation — they gate creation, not generation.
import { Injectable } from "@nestjs/common";
import { prisma, reserveTokens, reconcileReservation, releaseReservation, type ReserveTokensResult } from "@helpflow/database";
import { anchoredMonthlyPeriod, DEFAULTS } from "@helpflow/config";
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

  /** GET /api/orgs/:orgId/usage — current period used/reserved/limit, conversations, estimated
   * cost, and a per-chatbot daily token breakdown (Section 8 + Appendix C). */
  async getUsageSummary(organizationId: string) {
    const [limits, period] = await Promise.all([this.getPlanLimits(organizationId), this.getCurrentPeriod(organizationId)]);

    const counter = await prisma.usageCounter.findUnique({
      where: { organizationId_periodStart: { organizationId, periodStart: period.periodStart } },
    });
    const costRow = await prisma.aiUsage.aggregate({
      where: { organizationId, createdAt: { gte: period.periodStart, lt: period.periodEnd } },
      _sum: { estimatedCostMicros: true },
    });

    const today = new Date();
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const chatbots = await prisma.chatbot.findMany({ where: { organizationId, disabledReason: null }, select: { id: true, name: true, dailyTokenCap: true } });
    const dailyRows = await prisma.chatbotDailyUsage.findMany({ where: { organizationId, day, chatbotId: { in: chatbots.map((c) => c.id) } } });
    const dailyByChatbot = new Map(dailyRows.map((r) => [r.chatbotId, r]));

    return {
      period: { start: period.periodStart, end: period.periodEnd },
      aiTokens: {
        // Cast BigInt -> Number: JSON.stringify can't serialize BigInt, and token counts stay
        // far under Number.MAX_SAFE_INTEGER at this app's scale.
        used: Number(counter?.aiTokensUsed ?? 0n),
        reserved: Number(counter?.aiTokensReserved ?? 0n),
        limit: limits.monthlyAiTokens,
      },
      conversations: {
        used: counter?.conversationsCount ?? 0,
        limit: limits.monthlyConversations,
      },
      estimatedCostMicros: Number(costRow._sum.estimatedCostMicros ?? 0n),
      chatbotsDaily: chatbots.map((chatbot) => {
        const row = dailyByChatbot.get(chatbot.id);
        return {
          chatbotId: chatbot.id,
          name: chatbot.name,
          used: row?.aiTokensUsed ?? 0,
          reserved: row?.aiTokensReserved ?? 0,
          cap: chatbot.dailyTokenCap ?? DEFAULTS.quota.dailyTokenCapPerChatbot,
        };
      }),
    };
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
