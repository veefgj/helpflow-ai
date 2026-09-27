// socket-events.ts "/agent" namespace: JWT + organizationId handshake, conversation:join (watch),
// and message:send restricted to the conversation's assigned agent.
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
let ownerUserId: string;

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@test.local`;
}

function connectAgentSocket(accessToken: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`${baseUrl}/agent`, { auth: { accessToken, organizationId }, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
    // Our own app-level rejection (bad token, not a member): the transport connects fine, then the
    // gateway emits a custom event and disconnects — this never reaches the client's connect_error.
    s.on("auth_error", (payload) => reject(new Error(JSON.stringify(payload))));
    s.on("disconnect", (reason) => reject(new Error(`disconnected: ${reason}`)));
  });
}

describe("Agent Socket.IO namespace (Phase 3)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const owner = await request(baseUrl).post("/api/auth/register").send({ email: uniqueEmail("agent-gw-owner"), password: "Sup3rSecret!", name: "Owner" });
    ownerToken = owner.body.accessToken;
    ownerUserId = owner.body.user.id;
    const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Agent GW Co" });
    organizationId = org.body.id;
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    chatbotId = chatbot.body.id;
  });

  afterAll(async () => {
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await app.close();
  });

  it("rejects a connection with an invalid access token", async () => {
    await expect(connectAgentSocket("not-a-real-token")).rejects.toBeTruthy();
  });

  it("connects, joins a conversation, and can reply once it is AGENT_ACTIVE and assigned to them", async () => {
    const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
    const conversation = await prisma.conversation.create({
      data: { organizationId, chatbotId, customerId: customer.id, status: "AGENT_ACTIVE", assignedAgentId: ownerUserId, assignedAt: new Date() },
    });

    const socket = await connectAgentSocket(ownerToken);
    try {
      const joinAck = await new Promise<{ ok: boolean; data?: { id: string } }>((resolve) => {
        socket.emit("conversation:join", { conversationId: conversation.id }, resolve);
      });
      expect(joinAck.ok).toBe(true);
      expect(joinAck.data?.id).toBe(conversation.id);

      const sendAck = await new Promise<{ ok: boolean; data?: { content: string } }>((resolve) => {
        socket.emit("message:send", { conversationId: conversation.id, clientMessageId: randomUUID(), content: "How can I help?" }, resolve);
      });
      expect(sendAck.ok).toBe(true);
      expect(sendAck.data?.content).toBe("How can I help?");

      const stored = await prisma.message.findFirst({ where: { conversationId: conversation.id, senderType: "AGENT" } });
      expect(stored?.senderId).toBe(ownerUserId);
    } finally {
      socket.disconnect();
    }
  });

  it("rejects message:send when the conversation is not assigned to this agent", async () => {
    const otherOwner = await request(baseUrl).post("/api/auth/register").send({ email: uniqueEmail("agent-gw-other"), password: "Sup3rSecret!", name: "Other" });
    const otherOrg = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${otherOwner.body.accessToken}`).send({ name: "Other Co" });

    const customer = await prisma.customer.create({ data: { organizationId, visitorId: randomUUID() } });
    const conversation = await prisma.conversation.create({
      data: { organizationId, chatbotId, customerId: customer.id, status: "WAITING_AGENT", handoffRequestedAt: new Date() },
    });

    const socket = await connectAgentSocket(ownerToken);
    try {
      const ack = await new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => {
        socket.emit("message:send", { conversationId: conversation.id, clientMessageId: randomUUID(), content: "Hi" }, resolve);
      });
      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe("FORBIDDEN");
    } finally {
      socket.disconnect();
      await prisma.organization.delete({ where: { id: otherOrg.body.id } }).catch(() => undefined);
    }
  });
});
