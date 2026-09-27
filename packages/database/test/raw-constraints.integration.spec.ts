// Verifies the raw SQL contracts in sql/0002_raw_constraints.sql actually hold against a real
// Postgres — these are invariants Prisma's schema alone cannot express (Appendix B).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../index";

const suffix = randomUUID().slice(0, 8);
let organizationId: string;
let userId: string;
let chatbotId: string;
let customerId: string;

async function setupTenant() {
  const user = await prisma.user.create({
    data: { email: `raw-constraints-${suffix}@test.local`, passwordHash: "x", name: "Test" },
  });
  const org = await prisma.organization.create({
    data: { name: `Raw constraints org ${suffix}`, slug: `raw-constraints-${suffix}` },
  });
  await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const chatbot = await prisma.chatbot.create({
    data: { organizationId: org.id, name: "Test bot", allowedDomains: [] },
  });
  const customer = await prisma.customer.create({
    data: { organizationId: org.id, visitorId: randomUUID() },
  });
  return { userId: user.id, organizationId: org.id, chatbotId: chatbot.id, customerId: customer.id };
}

describe("raw SQL constraints (Appendix B)", () => {
  it("sets up a tenant fixture", async () => {
    ({ userId, organizationId, chatbotId, customerId } = await setupTenant());
    expect(organizationId).toBeTruthy();
  });

  it("memberships_one_owner_per_org: rejects a second OWNER in the same organization", async () => {
    const secondUser = await prisma.user.create({
      data: { email: `raw-constraints-2nd-owner-${suffix}@test.local`, passwordHash: "x", name: "Second" },
    });
    await expect(
      prisma.membership.create({ data: { organizationId, userId: secondUser.id, role: "OWNER" } }),
    ).rejects.toThrow();
    await prisma.user.delete({ where: { id: secondUser.id } });
  });

  it("conversations_one_open_per_customer: rejects a second non-CLOSED conversation for the same customer+chatbot", async () => {
    const first = await prisma.conversation.create({ data: { organizationId, chatbotId, customerId } });
    await expect(prisma.conversation.create({ data: { organizationId, chatbotId, customerId } })).rejects.toThrow();

    // A CLOSED conversation for the same pair does not collide with the partial index.
    await prisma.conversation.update({ where: { id: first.id }, data: { status: "CLOSED", closeReason: "CLOSED_BY_AGENT" } });
    const second = await prisma.conversation.create({ data: { organizationId, chatbotId, customerId } });
    await prisma.conversation.deleteMany({ where: { customerId } });
    expect(second.id).not.toBe(first.id);
  });

  it("conversations_assignment_matches_status: AGENT_ACTIVE requires assignedAgentId, and vice versa", async () => {
    await expect(
      prisma.conversation.create({ data: { organizationId, chatbotId, customerId, status: "AGENT_ACTIVE" } }),
    ).rejects.toThrow();

    await expect(
      prisma.conversation.create({
        data: { organizationId, chatbotId, customerId, status: "AI_ACTIVE", assignedAgentId: userId },
      }),
    ).rejects.toThrow();

    const ok = await prisma.conversation.create({
      data: { organizationId, chatbotId, customerId, status: "AGENT_ACTIVE", assignedAgentId: userId, assignedAt: new Date() },
    });
    expect(ok.assignedAgentId).toBe(userId);
    await prisma.conversation.delete({ where: { id: ok.id } });
  });

  it("usage_counters_non_negative: rejects a negative counter value", async () => {
    const now = new Date();
    await expect(
      prisma.usageCounter.create({
        data: { organizationId, periodStart: now, periodEnd: now, aiTokensUsed: -1 },
      }),
    ).rejects.toThrow();
  });
});

afterAll(async () => {
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  }
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});
