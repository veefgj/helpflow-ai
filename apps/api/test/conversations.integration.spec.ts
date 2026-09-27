// Section 7 "Conversation state machine" (T3/T6/T7/T8, REST) + T2 (widget handoff) + the Section 10
// critical scenario "Two agents accept: exactly one conditional update succeeds; the other 409s."
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { createTestApp } from "./utils/create-test-app";

let app: INestApplication;
let baseUrl: string;
let organizationId: string;
let chatbotId: string;
let ownerToken: string;
let agent1Token: string;
let agent1UserId: string;
let agent2Token: string;
let agent2UserId: string;

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@test.local`;
}

async function registerAndLogin(email: string) {
  const res = await request(baseUrl).post("/api/auth/register").send({ email, password: "Sup3rSecret!", name: "Test User" });
  expect(res.status).toBe(201);
  return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function inviteAndAccept(email: string, accessToken: string) {
  const invite = await request(baseUrl)
    .post(`/api/orgs/${organizationId}/invitations`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email, role: "AGENT" });
  const token = new URL(invite.body.inviteUrl).searchParams.get("token");
  await request(baseUrl).post("/api/invitations/accept").set("Authorization", `Bearer ${accessToken}`).send({ token });
}

async function createWaitingConversation() {
  const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
  return prisma.conversation.create({
    data: { organizationId, chatbotId, customerId: customer.id, status: "WAITING_AGENT", handoffRequestedAt: new Date() },
  });
}

describe("Conversation state machine over REST (Phase 3)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const owner = await registerAndLogin(uniqueEmail("conv-owner"));
    ownerToken = owner.accessToken;
    const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Conv Co" });
    organizationId = org.body.id;
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    chatbotId = chatbot.body.id;

    const agent1 = await registerAndLogin(uniqueEmail("agent1"));
    agent1Token = agent1.accessToken;
    agent1UserId = agent1.userId;
  });

  afterAll(async () => {
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await app.close();
  });

  it("two agents racing to accept the same waiting conversation: exactly one wins with 200, the other 409s", async () => {
    // Re-invite agent1 with their real email (the beforeAll invite used a throwaway address).
    const agent1Email = (await prisma.user.findUniqueOrThrow({ where: { id: agent1UserId } })).email;
    await inviteAndAccept(agent1Email, agent1Token);

    const agent2 = await registerAndLogin(uniqueEmail("agent2"));
    agent2Token = agent2.accessToken;
    agent2UserId = agent2.userId;
    await inviteAndAccept((await prisma.user.findUniqueOrThrow({ where: { id: agent2UserId } })).email, agent2Token);

    const conversation = await createWaitingConversation();

    const [r1, r2] = await Promise.all([
      request(baseUrl).post(`/api/orgs/${organizationId}/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${agent1Token}`),
      request(baseUrl).post(`/api/orgs/${organizationId}/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${agent2Token}`),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 200 ? r2 : r1;
    expect(winner.body.status).toBe("AGENT_ACTIVE");
    expect(loser.body.code).toBe("CONVERSATION_ALREADY_ASSIGNED");
    expect(loser.body.details.currentState.status).toBe("AGENT_ACTIVE");

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect([agent1UserId, agent2UserId]).toContain(updated.assignedAgentId);

    const systemMessage = await prisma.message.findFirst({ where: { conversationId: conversation.id, senderType: "SYSTEM" } });
    expect(systemMessage).not.toBeNull();
  });

  it("full lifecycle: reassign → forbidden release by the wrong agent → release → owner takeover → close", async () => {
    const conversation = await createWaitingConversation();

    const accept = await request(baseUrl).post(`/api/orgs/${organizationId}/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${agent1Token}`);
    expect(accept.status).toBe(200);

    const reassign = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/conversations/${conversation.id}/reassign`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ agentUserId: agent2UserId });
    expect(reassign.status).toBe(200);
    expect(reassign.body.assignedAgentId).toBe(agent2UserId);

    const forbiddenRelease = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/conversations/${conversation.id}/release`)
      .set("Authorization", `Bearer ${agent1Token}`);
    expect(forbiddenRelease.status).toBe(403);

    const release = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/conversations/${conversation.id}/release`)
      .set("Authorization", `Bearer ${agent2Token}`);
    expect(release.status).toBe(200);
    expect(release.body.status).toBe("WAITING_AGENT");
    expect(release.body.assignedAgentId).toBeNull();

    const takeover = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/conversations/${conversation.id}/takeover`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(takeover.status).toBe(200);
    expect(takeover.body.status).toBe("AGENT_ACTIVE");

    const close = await request(baseUrl).post(`/api/orgs/${organizationId}/conversations/${conversation.id}/close`).set("Authorization", `Bearer ${ownerToken}`);
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("CLOSED");
    expect(close.body.closeReason).toBe("CLOSED_BY_AGENT");
  });

  it("T2: a customer can request a handoff mid AI_ACTIVE conversation, moving it to WAITING_AGENT", async () => {
    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId });
    const socket: Socket = await new Promise((resolve, reject) => {
      const s = io(`${baseUrl}/widget`, { auth: { visitorToken: session.body.visitorToken }, transports: ["websocket"], reconnection: false });
      s.on("connect", () => resolve(s));
      s.on("connect_error", reject);
    });

    const ack = await new Promise<{ ok: boolean; data?: { conversation: { id: string; status: string } } }>((resolve) => {
      socket.emit("message:send", { clientMessageId: randomUUID(), content: "Hello?" }, resolve);
    });
    expect(ack.ok).toBe(true);
    const conversationId = ack.data!.conversation.id;
    expect(ack.data!.conversation.status).toBe("AI_ACTIVE");

    const handoff = await request(baseUrl)
      .post(`/api/widget/conversations/${conversationId}/handoff`)
      .set("X-Visitor-Token", session.body.visitorToken);
    expect(handoff.status).toBe(200);
    expect(handoff.body.status).toBe("WAITING_AGENT");
    expect(handoff.body.handoffRequestedAt).not.toBeNull();

    socket.disconnect();
  });
});
