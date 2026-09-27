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

  /** Section 8 "Downgrade policy": called after any plan change (up or down). Never deletes
   * anything — only flips disabledReason between null and PLAN_LIMIT, and only the minimum delta
   * needed to fit the new limit. USER-disabled rows and the Owner's own membership are never
   * touched. Idempotent: calling it again with no plan change is a no-op. */
  async reconcilePlanLimits(organizationId: string): Promise<void> {
    const limits = await this.getPlanLimits(organizationId);
    await this.reconcileOneResource(organizationId, "chatbots", limits.maxChatbots);
    await this.reconcileOneResource(organizationId, "documents", limits.maxDocuments);
    await this.reconcileOneResource(organizationId, "agents", limits.maxAgents);
  }

  private async reconcileOneResource(organizationId: string, resource: "chatbots" | "documents" | "agents", limit: number | null): Promise<void> {
    const rows = await resourceRows(organizationId, resource);
    const { activate, deactivate } = reconcileRows(rows, limit);
    await Promise.all([activateResourceRows(resource, activate), deactivateResourceRows(resource, deactivate)]);
  }

  /** POST /api/orgs/:orgId/plan-resources/activate — Owner picks which specific resources stay
   * active after a downgrade, instead of the default oldest-first selection. */
  async activatePlanResources(organizationId: string, resource: "chatbots" | "documents" | "agents", ids: string[]): Promise<void> {
    const limits = await this.getPlanLimits(organizationId);
    const limit = resource === "chatbots" ? limits.maxChatbots : resource === "documents" ? limits.maxDocuments : limits.maxAgents;
    if (limit !== null && ids.length > limit) {
      throw new HelpFlowApiException(ApiErrorCode.PLAN_LIMIT_EXCEEDED, `This plan allows at most ${limit} ${resource}`, { limit, resource });
    }

    // Never touch USER-disabled rows, and (for memberships) never touch the OWNER row.
    const eligible = await resourceRows(organizationId, resource);
    const eligibleIds = new Set(eligible.map((r) => r.id));
    const toActivate = ids.filter((id) => eligibleIds.has(id));
    const toDeactivate = [...eligibleIds].filter((id) => !toActivate.includes(id));

    await Promise.all([activateResourceRows(resource, toActivate), deactivateResourceRows(resource, toDeactivate)]);
  }
}

interface ResourceRow {
  id: string;
  createdAt: Date;
  disabledReason: "USER" | "PLAN_LIMIT" | null;
}

/** Every row of a resource type that isn't USER-disabled and isn't the org's Owner membership —
 * the only rows reconciliation or the activate endpoint is ever allowed to touch. */
async function resourceRows(organizationId: string, resource: "chatbots" | "documents" | "agents"): Promise<ResourceRow[]> {
  const where = { organizationId, OR: [{ disabledReason: null }, { disabledReason: "PLAN_LIMIT" as const }] };
  if (resource === "chatbots") return prisma.chatbot.findMany({ where, select: { id: true, createdAt: true, disabledReason: true } });
  if (resource === "documents") return prisma.document.findMany({ where: { ...where, deletedAt: null }, select: { id: true, createdAt: true, disabledReason: true } });
  return prisma.membership.findMany({ where: { ...where, role: { not: "OWNER" } }, select: { id: true, createdAt: true, disabledReason: true } });
}

async function activateResourceRows(resource: "chatbots" | "documents" | "agents", ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (resource === "chatbots") await prisma.chatbot.updateMany({ where: { id: { in: ids } }, data: { disabledReason: null } });
  else if (resource === "documents") await prisma.document.updateMany({ where: { id: { in: ids } }, data: { disabledReason: null } });
  else await prisma.membership.updateMany({ where: { id: { in: ids } }, data: { disabledReason: null } });
}

async function deactivateResourceRows(resource: "chatbots" | "documents" | "agents", ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (resource === "chatbots") await prisma.chatbot.updateMany({ where: { id: { in: ids } }, data: { disabledReason: "PLAN_LIMIT" } });
  else if (resource === "documents") await prisma.document.updateMany({ where: { id: { in: ids } }, data: { disabledReason: "PLAN_LIMIT" } });
  else await prisma.membership.updateMany({ where: { id: { in: ids } }, data: { disabledReason: "PLAN_LIMIT" } });
}

/** The reconciliation itself is resource-agnostic once we have the plain id/createdAt/disabledReason
 * rows: disable the newest active rows beyond the limit (downgrade), or re-enable the oldest
 * PLAN_LIMIT rows up to the new room (upgrade) — never both in the same pass. */
function reconcileRows(rows: ResourceRow[], limit: number | null): { activate: string[]; deactivate: string[] } {
  const active = rows.filter((r) => r.disabledReason === null).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const planLimited = rows.filter((r) => r.disabledReason === "PLAN_LIMIT").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (limit !== null && active.length > limit) {
    const excess = active.slice(limit).map((r) => r.id); // newest beyond the limit
    return { activate: [], deactivate: excess };
  }
  if (limit === null || active.length < limit) {
    const room = limit === null ? planLimited.length : limit - active.length;
    return { activate: planLimited.slice(0, room).map((r) => r.id), deactivate: [] };
  }
  return { activate: [], deactivate: [] };
}
