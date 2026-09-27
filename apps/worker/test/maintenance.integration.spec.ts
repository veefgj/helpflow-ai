// Section 4 (soft-deleted document purge retry), Section 7 T9 (AI inactivity close), and Section 8
// (stale token reservation release) — the three maintenance sweeps, exercised directly against a
// real Postgres the same way conversation-timers.integration.spec.ts calls its handlers directly.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@helpflow/database";
import { closeInactiveAiConversations, purgeSoftDeletedDocuments, sweepStaleTokenReservations } from "../src/queues/maintenance.worker";

const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];

async function setupOrgWithChatbot() {
  const org = await prisma.organization.create({ data: { name: `Maint ${suffix}-${randomUUID().slice(0, 4)}`, slug: `maint-${randomUUID()}` } });
  organizationIds.push(org.id);
  const chatbot = await prisma.chatbot.create({ data: { organizationId: org.id, name: "Bot", allowedDomains: [] } });
  const kb = await prisma.knowledgeBase.create({ data: { organizationId: org.id, name: "KB", isDefault: true } });
  const user = await prisma.user.create({ data: { email: `maint-${randomUUID()}@test.local`, passwordHash: "x", name: "Uploader" } });
  return { organizationId: org.id, chatbotId: chatbot.id, knowledgeBaseId: kb.id, userId: user.id };
}

describe("maintenance sweeps (Phase 4)", () => {
  it("purges a soft-deleted document whose chunks/object were never cleaned up", async () => {
    const { organizationId, knowledgeBaseId, userId } = await setupOrgWithChatbot();
    const doc = await prisma.document.create({
      data: {
        organizationId,
        knowledgeBaseId,
        fileName: "old.txt",
        type: "TXT",
        mimeType: "text/plain",
        sizeBytes: 10,
        checksumSha256: randomUUID(),
        storageKey: `orgs/${organizationId}/does-not-exist.txt`,
        deletedAt: new Date(),
        uploadedById: userId,
      },
    });

    await purgeSoftDeletedDocuments();

    const remaining = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(remaining).toBeNull();
  });

  it("closes an AI_ACTIVE conversation that has been inactive past the cutoff (T9)", async () => {
    const { organizationId, chatbotId } = await setupOrgWithChatbot();
    const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
    const staleCutoff = new Date(Date.now() - 25 * 60 * 60 * 1000); // aiInactivityCloseHours default is 24h
    const conversation = await prisma.conversation.create({
      data: { organizationId, chatbotId, customerId: customer.id, status: "AI_ACTIVE", lastMessageAt: staleCutoff },
    });

    await closeInactiveAiConversations();

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("CLOSED");
    expect(updated.closeReason).toBe("INACTIVITY");
  });

  it("leaves a recently-active AI_ACTIVE conversation untouched", async () => {
    const { organizationId, chatbotId } = await setupOrgWithChatbot();
    const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
    const conversation = await prisma.conversation.create({
      data: { organizationId, chatbotId, customerId: customer.id, status: "AI_ACTIVE", lastMessageAt: new Date() },
    });

    await closeInactiveAiConversations();

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("AI_ACTIVE");
  });

  it("releases a token reservation stuck in RESERVED past the staleness cutoff", async () => {
    const { organizationId, chatbotId } = await setupOrgWithChatbot();
    const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
    const conversation = await prisma.conversation.create({ data: { organizationId, chatbotId, customerId: customer.id } });
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const counter = await prisma.usageCounter.create({
      data: { organizationId, periodStart, periodEnd, aiTokensReserved: 600 }, // 500 (stale) + 100 (fresh)
    });
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await prisma.chatbotDailyUsage.create({ data: { chatbotId, day, organizationId, aiTokensReserved: 600 } });
    const stale = await prisma.tokenReservation.create({
      data: {
        organizationId,
        chatbotId,
        usageCounterId: counter.id,
        day,
        conversationId: conversation.id,
        estimatedTokens: 500,
        createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h old — well past the 10min default cutoff
      },
    });
    const fresh = await prisma.tokenReservation.create({
      data: { organizationId, chatbotId, usageCounterId: counter.id, day, conversationId: conversation.id, estimatedTokens: 100 },
    });

    await sweepStaleTokenReservations();

    const staleAfter = await prisma.tokenReservation.findUniqueOrThrow({ where: { id: stale.id } });
    const freshAfter = await prisma.tokenReservation.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(staleAfter.status).toBe("RELEASED");
    expect(freshAfter.status).toBe("RESERVED"); // untouched — not old enough to sweep

    const counterAfter = await prisma.usageCounter.findUniqueOrThrow({ where: { id: counter.id } });
    expect(counterAfter.aiTokensReserved).toBe(100n); // only the stale 500 was released, the fresh 100 remains
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } }).catch(() => undefined);
});
