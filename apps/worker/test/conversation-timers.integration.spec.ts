// Section 7 T4/T5 (handoff-timeout) and T6 (agent-grace) — exercised directly against a real
// Postgres, the same way apps/worker's document-processing tests call processDocument directly.
import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@helpflow/database";
import { handleAgentGrace, handleHandoffTimeout } from "../src/queues/conversation-timers.worker";

const suffix = randomUUID().slice(0, 8);
let organizationId: string;
let userId: string;

function fakeJob(conversationId: string): Job<{ conversationId: string }> {
  return { data: { conversationId } } as Job<{ conversationId: string }>;
}

async function createConversation(overrides: {
  chatbotUnavailablePolicy?: "RESUME_AI" | "COLLECT_EMAIL";
  status: "AI_ACTIVE" | "WAITING_AGENT" | "AGENT_ACTIVE";
  assignedAgentId?: string | null;
}) {
  const chatbot = await prisma.chatbot.create({
    data: { organizationId, name: "Bot", allowedDomains: [], unavailablePolicy: overrides.chatbotUnavailablePolicy ?? "RESUME_AI" },
  });
  const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
  return prisma.conversation.create({
    data: {
      organizationId,
      chatbotId: chatbot.id,
      customerId: customer.id,
      status: overrides.status,
      assignedAgentId: overrides.assignedAgentId ?? null,
      assignedAt: overrides.assignedAgentId ? new Date() : null,
      handoffRequestedAt: overrides.status !== "AI_ACTIVE" ? new Date() : null,
    },
  });
}

describe("conversation timers (Section 7 T4/T5/T6)", () => {
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `Timers ${suffix}-${randomUUID().slice(0, 4)}`, slug: `timers-${randomUUID()}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { email: `timer-agent-${randomUUID()}@test.local`, passwordHash: "x", name: "Agent" } });
    userId = user.id;
  });

  it("T4: RESUME_AI policy returns an unaccepted WAITING_AGENT conversation to AI_ACTIVE", async () => {
    const conversation = await createConversation({ status: "WAITING_AGENT", chatbotUnavailablePolicy: "RESUME_AI" });
    await handleHandoffTimeout(fakeJob(conversation.id));

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("AI_ACTIVE");
    expect(updated.handoffRequestedAt).toBeNull();

    const systemMessage = await prisma.message.findFirst({ where: { conversationId: conversation.id, senderType: "SYSTEM" } });
    expect(systemMessage?.content).toMatch(/AI assistant will continue/i);
  });

  it("T5: COLLECT_EMAIL policy closes an unaccepted WAITING_AGENT conversation as AGENT_UNAVAILABLE", async () => {
    const conversation = await createConversation({ status: "WAITING_AGENT", chatbotUnavailablePolicy: "COLLECT_EMAIL" });
    await handleHandoffTimeout(fakeJob(conversation.id));

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("CLOSED");
    expect(updated.closeReason).toBe("AGENT_UNAVAILABLE");
  });

  it("is a no-op (stale timer) when the conversation was already accepted", async () => {
    const conversation = await createConversation({ status: "AGENT_ACTIVE", assignedAgentId: userId });
    await handleHandoffTimeout(fakeJob(conversation.id));

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("AGENT_ACTIVE"); // untouched
  });

  it("T6: agent-grace releases an AGENT_ACTIVE conversation back to WAITING_AGENT", async () => {
    const conversation = await createConversation({ status: "AGENT_ACTIVE", assignedAgentId: userId });
    await handleAgentGrace(fakeJob(conversation.id));

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("WAITING_AGENT");
    expect(updated.assignedAgentId).toBeNull();

    const systemMessage = await prisma.message.findFirst({ where: { conversationId: conversation.id, senderType: "SYSTEM" } });
    expect(systemMessage?.content).toMatch(/agent disconnected/i);
  });

  it("agent-grace is a no-op (stale timer) when the conversation was already released or closed", async () => {
    const conversation = await createConversation({ status: "WAITING_AGENT" });
    await handleAgentGrace(fakeJob(conversation.id));

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("WAITING_AGENT"); // untouched, no error thrown
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: "timers-" } } }).catch(() => undefined);
  await prisma.$disconnect();
});
