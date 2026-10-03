// Section 7 T10: the customer ends the conversation from the widget — from AI_ACTIVE, WAITING_AGENT
// or AGENT_ACTIVE — via one conditional UPDATE; a second close (or a lost race) 409s with the current
// state, another visitor's conversation 404s, and the next message lazily opens a new conversation.
// Runs with AI_PROVIDER=fake (as CI does).
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { t, type ConversationDto } from "@helpflow/types";
import { createTestApp } from "./utils/create-test-app";

let app: INestApplication;
let baseUrl: string;
let organizationId: string;
let chatbotId: string;
let ownerToken: string;
let ownerUserId: string;

async function openVisitor(): Promise<{ token: string; socket: Socket }> {
  const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId });
  const token = session.body.visitorToken as string;
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = io(`${baseUrl}/widget`, { auth: { visitorToken: token }, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
  return { token, socket };
}

/** First message → T1; waits for the AI reply so no generation is in flight afterwards. */
async function startConversation(socket: Socket, content = "xin chào"): Promise<ConversationDto> {
  const replied = new Promise((resolve) => socket.once("ai:completed", resolve));
  const ack = await new Promise<{ ok: boolean; data: { conversation: ConversationDto } }>((resolve) =>
    socket.emit("message:send", { clientMessageId: randomUUID(), content }, resolve),
  );
  expect(ack.ok).toBe(true);
  await replied;
  return ack.data.conversation;
}

function closeAs(token: string, conversationId: string) {
  return request(baseUrl).post(`/api/widget/conversations/${conversationId}/close`).set("X-Visitor-Token", token);
}

describe("T10: customer ends the conversation (Section 7)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const owner = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email: `close-${randomUUID().slice(0, 8)}@test.local`, password: "Sup3rSecret!", name: "Owner" });
    ownerToken = owner.body.accessToken;
    ownerUserId = owner.body.user.id;
    const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Close Co" });
    organizationId = org.body.id;
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    chatbotId = chatbot.body.id;
  });

  afterAll(async () => {
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await app.close();
  });

  it("closes an AI_ACTIVE conversation with a localized SYSTEM message and a conversation:updated push", async () => {
    const { token, socket } = await openVisitor();
    try {
      const conversation = await startConversation(socket);
      const pushed = new Promise<ConversationDto>((resolve) => socket.once("conversation:updated", resolve));

      const res = await closeAs(token, conversation.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "CLOSED", closeReason: "CLOSED_BY_CUSTOMER" });
      expect((await pushed).status).toBe("CLOSED");

      const system = await prisma.message.findFirst({ where: { conversationId: conversation.id, senderType: "SYSTEM" }, orderBy: { seq: "desc" } });
      expect(system?.content).toBe(t("vi", "closedByCustomer"));
    } finally {
      socket.disconnect();
    }
  });

  it("closes a WAITING_AGENT conversation so no agent can accept it afterwards", async () => {
    const { token, socket } = await openVisitor();
    try {
      const conversation = await startConversation(socket);
      const handoff = await request(baseUrl).post(`/api/widget/conversations/${conversation.id}/handoff`).set("X-Visitor-Token", token);
      expect(handoff.body.status).toBe("WAITING_AGENT");

      expect((await closeAs(token, conversation.id)).status).toBe(200);

      const accept = await request(baseUrl)
        .post(`/api/orgs/${organizationId}/conversations/${conversation.id}/accept`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(accept.status).toBe(409);
    } finally {
      socket.disconnect();
    }
  });

  it("closes an AGENT_ACTIVE conversation and releases the agent", async () => {
    const { token, socket } = await openVisitor();
    try {
      const conversation = await startConversation(socket);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "AGENT_ACTIVE", assignedAgentId: ownerUserId, assignedAt: new Date(), handoffRequestedAt: new Date() },
      });

      const res = await closeAs(token, conversation.id);
      expect(res.status).toBe(200);
      const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      expect(row).toMatchObject({ status: "CLOSED", closeReason: "CLOSED_BY_CUSTOMER", assignedAgentId: null });

      // The agent's own close now loses: the conversation is no longer AGENT_ACTIVE.
      const agentClose = await request(baseUrl)
        .post(`/api/orgs/${organizationId}/conversations/${conversation.id}/close`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(agentClose.status).toBe(409);
    } finally {
      socket.disconnect();
    }
  });

  it("409s with the current state when closing twice, and 404s for another visitor", async () => {
    const owner = await openVisitor();
    const stranger = await openVisitor();
    try {
      const conversation = await startConversation(owner.socket);

      expect((await closeAs(stranger.token, conversation.id)).status).toBe(404);

      expect((await closeAs(owner.token, conversation.id)).status).toBe(200);
      const again = await closeAs(owner.token, conversation.id);
      expect(again.status).toBe(409);
      expect(again.body.details.currentState).toMatchObject({ status: "CLOSED" });
    } finally {
      owner.socket.disconnect();
      stranger.socket.disconnect();
    }
  });

  it("the next customer message after closing opens a new conversation", async () => {
    const { token, socket } = await openVisitor();
    try {
      const first = await startConversation(socket);
      expect((await closeAs(token, first.id)).status).toBe(200);

      const second = await startConversation(socket, "hello again");
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe("AI_ACTIVE");
    } finally {
      socket.disconnect();
    }
  });
});
