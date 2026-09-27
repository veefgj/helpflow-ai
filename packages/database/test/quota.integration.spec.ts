// Section 8 "Token reservation and reconciliation" + Section 10 "Concurrent quota requests":
// reservations must never push used + reserved above the monthly limit or the daily cap, even
// under real concurrency — exercised here with actual parallel requests against real Postgres.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../index";
import { reconcileReservation, releaseReservation, reserveTokens } from "../repositories/quota.repository";

const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];

async function setupOrgWithChatbot() {
  const org = await prisma.organization.create({ data: { name: `Quota ${suffix}-${randomUUID().slice(0, 4)}`, slug: `quota-${randomUUID()}` } });
  organizationIds.push(org.id);
  const chatbot = await prisma.chatbot.create({ data: { organizationId: org.id, name: "Bot", allowedDomains: [] } });
  const customer = await prisma.customer.create({ data: { organizationId: org.id, visitorId: randomUUID() } });
  const conversation = await prisma.conversation.create({ data: { organizationId: org.id, chatbotId: chatbot.id, customerId: customer.id } });
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { organizationId: org.id, chatbotId: chatbot.id, conversationId: conversation.id, periodStart, periodEnd };
}

describe("quota reservation (Section 8 + Appendix B Q4)", () => {
  it("reserves tokens when within both the monthly limit and the daily cap", async () => {
    const fixture = await setupOrgWithChatbot();
    const result = await reserveTokens({
      organizationId: fixture.organizationId,
      chatbotId: fixture.chatbotId,
      conversationId: fixture.conversationId,
      estimatedTokens: 500,
      periodStart: fixture.periodStart,
      periodEnd: fixture.periodEnd,
      monthlyLimit: 1000,
      dailyCap: 100_000,
    });
    expect(result.ok).toBe(true);

    const counter = await prisma.usageCounter.findUniqueOrThrow({ where: { id: (result as { usageCounterId: string }).usageCounterId } });
    expect(counter.aiTokensReserved).toBe(500n);
  });

  it("rejects a reservation that would exceed the monthly limit", async () => {
    const fixture = await setupOrgWithChatbot();
    const first = await reserveTokens({
      organizationId: fixture.organizationId,
      chatbotId: fixture.chatbotId,
      conversationId: fixture.conversationId,
      estimatedTokens: 900,
      periodStart: fixture.periodStart,
      periodEnd: fixture.periodEnd,
      monthlyLimit: 1000,
      dailyCap: 100_000,
    });
    expect(first.ok).toBe(true);

    const second = await reserveTokens({
      organizationId: fixture.organizationId,
      chatbotId: fixture.chatbotId,
      conversationId: fixture.conversationId,
      estimatedTokens: 200, // 900 + 200 > 1000
      periodStart: fixture.periodStart,
      periodEnd: fixture.periodEnd,
      monthlyLimit: 1000,
      dailyCap: 100_000,
    });
    expect(second).toEqual({ ok: false, reason: "QUOTA_EXCEEDED" });
  });

  it("rejects a reservation that would exceed the per-chatbot daily cap", async () => {
    const fixture = await setupOrgWithChatbot();
    const result = await reserveTokens({
      organizationId: fixture.organizationId,
      chatbotId: fixture.chatbotId,
      conversationId: fixture.conversationId,
      estimatedTokens: 500,
      periodStart: fixture.periodStart,
      periodEnd: fixture.periodEnd,
      monthlyLimit: 1_000_000,
      dailyCap: 100,
    });
    expect(result).toEqual({ ok: false, reason: "DAILY_CAP_EXCEEDED" });

    // The failed daily check must not leave a dangling monthly reservation behind.
    const counter = await prisma.usageCounter.findFirst({ where: { organizationId: fixture.organizationId } });
    expect(counter?.aiTokensReserved).toBe(0n);
  });

  it("never lets concurrent reservations push reserved above the monthly limit", async () => {
    const fixture = await setupOrgWithChatbot();
    const attempts = Array.from({ length: 5 }, () =>
      reserveTokens({
        organizationId: fixture.organizationId,
        chatbotId: fixture.chatbotId,
        conversationId: fixture.conversationId,
        estimatedTokens: 300,
        periodStart: fixture.periodStart,
        periodEnd: fixture.periodEnd,
        monthlyLimit: 1000, // only 3 of 5 concurrent 300-token requests can fit
        dailyCap: 100_000,
      }),
    );
    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.ok);
    expect(succeeded.length).toBe(3);

    const counter = await prisma.usageCounter.findFirst({ where: { organizationId: fixture.organizationId } });
    expect(counter!.aiTokensReserved).toBe(900n);
    expect(counter!.aiTokensUsed + counter!.aiTokensReserved <= 1000n).toBe(true);
  });

  it("reconciles a reservation to the actual usage, settling it exactly once", async () => {
    const fixture = await setupOrgWithChatbot();
    const result = await reserveTokens({
      organizationId: fixture.organizationId,
      chatbotId: fixture.chatbotId,
      conversationId: fixture.conversationId,
      estimatedTokens: 800,
      periodStart: fixture.periodStart,
      periodEnd: fixture.periodEnd,
      monthlyLimit: 1000,
      dailyCap: 100_000,
    });
    expect(result.ok).toBe(true);
    const reservationId = (result as { reservationId: string }).reservationId;

    await reconcileReservation(reservationId, 650); // actual usage came in lower than the estimate
    await reconcileReservation(reservationId, 999); // second call is a no-op (already settled)

    const counter = await prisma.usageCounter.findFirst({ where: { organizationId: fixture.organizationId } });
    expect(counter!.aiTokensReserved).toBe(0n);
    expect(counter!.aiTokensUsed).toBe(650n); // not 650+999 — the second reconcile did nothing

    const reservation = await prisma.tokenReservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(reservation.status).toBe("RECONCILED");
  });

  it("releases a reservation without recording any usage on failure", async () => {
    const fixture = await setupOrgWithChatbot();
    const result = await reserveTokens({
      organizationId: fixture.organizationId,
      chatbotId: fixture.chatbotId,
      conversationId: fixture.conversationId,
      estimatedTokens: 400,
      periodStart: fixture.periodStart,
      periodEnd: fixture.periodEnd,
      monthlyLimit: 1000,
      dailyCap: 100_000,
    });
    await releaseReservation((result as { reservationId: string }).reservationId);

    const counter = await prisma.usageCounter.findFirst({ where: { organizationId: fixture.organizationId } });
    expect(counter!.aiTokensReserved).toBe(0n);
    expect(counter!.aiTokensUsed).toBe(0n);
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } }).catch(() => undefined);
  await prisma.$disconnect();
});
