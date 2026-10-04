// Section 8 "Usage quota & billing": resource-count limits at creation time (chatbots/documents/
// agents), the T1 conversations/month limit, and the AI reply pipeline's token reservation
// (monthly quota + per-chatbot daily cap) — plus GET /api/orgs/:orgId/usage. Exercised over real
// HTTP/Socket.IO against a real Postgres, the same way widget-rag.integration.spec.ts does.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma, replaceDocumentChunks } from "@helpflow/database";
import { anchoredMonthlyPeriod } from "@helpflow/config";
import { getEmbeddingProvider } from "@helpflow/ai";
import { createTestApp } from "./utils/create-test-app";

let app: INestApplication;
let baseUrl: string;
const organizationIds: string[] = [];

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@test.local`;
}

async function registerAndCreateOrg(label: string) {
  const owner = await request(baseUrl).post("/api/auth/register").send({ email: uniqueEmail(label), password: "Sup3rSecret!", name: "Test Owner" });
  const ownerToken = owner.body.accessToken as string;
  const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: `${label} Co` });
  organizationIds.push(org.body.id);
  return { ownerToken, organizationId: org.body.id as string };
}

async function currentPeriod(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return anchoredMonthlyPeriod(org.quotaAnchorAt);
}

async function seedReadyDocument(organizationId: string, knowledgeBaseId: string, content: string) {
  const document = await prisma.document.create({
    data: {
      organizationId,
      knowledgeBaseId,
      fileName: "seed.txt",
      type: "TXT",
      mimeType: "text/plain",
      sizeBytes: content.length,
      checksumSha256: randomUUID(),
      storageKey: `test/${randomUUID()}.txt`,
      uploadedById: randomUUID(),
      status: "READY",
    },
  });
  const [embedded] = await getEmbeddingProvider().embed([content]);
  await replaceDocumentChunks({
    documentId: document.id,
    organizationId,
    knowledgeBaseId,
    embeddingModel: getEmbeddingProvider().model,
    chunks: [{ chunkIndex: 0, pageNumber: 1, content, tokenCount: 20, embedding: embedded!.embedding }],
  });
}

function connectWidgetSocket(visitorToken: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/widget`, { auth: { visitorToken }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

describe("Quota enforcement (Phase 4, Section 8)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const id of organizationIds) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it("blocks creating a second chatbot on the FREE plan (maxChatbots = 1)", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("chatbot-limit");

    const first = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot 1" });
    expect(first.status).toBe(201);

    const second = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot 2" });
    expect(second.status).toBe(402);
    expect(second.body.code).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("blocks inviting a second agent on the FREE plan (maxAgents = 1, owner already counts)", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("agent-limit");

    const invite = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/invitations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: uniqueEmail("agent-limit-invitee"), role: "AGENT" });
    expect(invite.status).toBe(402);
    expect(invite.body.code).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("blocks a 6th document upload on the FREE plan (maxDocuments = 5)", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("document-limit");
    await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    const kbs = await request(baseUrl).get(`/api/orgs/${organizationId}/knowledge-bases`).set("Authorization", `Bearer ${ownerToken}`);
    const knowledgeBaseId = kbs.body[0].id as string;

    for (let i = 0; i < 5; i++) {
      await prisma.document.create({
        data: {
          organizationId,
          knowledgeBaseId,
          fileName: `f${i}.txt`,
          type: "TXT",
          mimeType: "text/plain",
          sizeBytes: 10,
          checksumSha256: randomUUID(),
          storageKey: `test/${randomUUID()}.txt`,
          uploadedById: randomUUID(),
          status: "READY",
        },
      });
    }

    const sixth = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/knowledge-bases/${knowledgeBaseId}/documents`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("file", Buffer.from("sixth document content"), { filename: "sixth.txt", contentType: "text/plain" });
    expect(sixth.status).toBe(402);
    expect(sixth.body.code).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("returns QUOTA_EXCEEDED for a new conversation once the monthly conversation limit is reached (T1)", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("conversation-limit");
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });

    const period = await currentPeriod(organizationId);
    await prisma.usageCounter.create({
      data: { organizationId, periodStart: period.periodStart, periodEnd: period.periodEnd, conversationsCount: 100 }, // FREE limit
    });

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId: chatbot.body.id });
    const socket = await connectWidgetSocket(session.body.visitorToken);
    try {
      const ack = await new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => {
        socket.emit("message:send", { clientMessageId: randomUUID(), content: "Hello?" }, resolve);
      });
      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe("QUOTA_EXCEEDED");
    } finally {
      socket.disconnect();
    }
  });

  it("fails the AI reply with QUOTA_EXCEEDED once the monthly AI token limit is already used up", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("token-limit");
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    const kbs = await request(baseUrl).get(`/api/orgs/${organizationId}/knowledge-bases`).set("Authorization", `Bearer ${ownerToken}`);
    await seedReadyDocument(organizationId, kbs.body[0].id, "Our refund policy allows a full refund within 30 days of purchase.");

    const period = await currentPeriod(organizationId);
    await prisma.usageCounter.create({
      data: { organizationId, periodStart: period.periodStart, periodEnd: period.periodEnd, aiTokensUsed: 50_000 }, // FREE limit, already exhausted
    });

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId: chatbot.body.id });
    const socket = await connectWidgetSocket(session.body.visitorToken);
    try {
      const ack = await new Promise<{ ok: boolean }>((resolve) => {
        socket.emit("message:send", { clientMessageId: randomUUID(), content: "How many days do I have to request a refund?" }, resolve);
      });
      expect(ack.ok).toBe(true); // the conversation itself is created fine — only the AI reply fails

      const failed = await new Promise<{ error: { code: string } }>((resolve, reject) => {
        socket.on("ai:failed", resolve);
        socket.on("ai:completed", () => reject(new Error("expected ai:failed, got ai:completed")));
        setTimeout(() => reject(new Error("timed out waiting for ai:failed")), 10_000);
      });
      expect(failed.error.code).toBe("QUOTA_EXCEEDED");
    } finally {
      socket.disconnect();
    }
  });

  it("fails the AI reply with DAILY_CAP_EXCEEDED once the chatbot's own daily token cap is reached", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("daily-cap");
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    await prisma.chatbot.update({ where: { id: chatbot.body.id }, data: { dailyTokenCap: 1 } }); // effectively zero headroom
    const kbs = await request(baseUrl).get(`/api/orgs/${organizationId}/knowledge-bases`).set("Authorization", `Bearer ${ownerToken}`);
    await seedReadyDocument(organizationId, kbs.body[0].id, "Our refund policy allows a full refund within 30 days of purchase.");

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId: chatbot.body.id });
    const socket = await connectWidgetSocket(session.body.visitorToken);
    try {
      const ack = await new Promise<{ ok: boolean }>((resolve) => {
        socket.emit("message:send", { clientMessageId: randomUUID(), content: "How many days do I have to request a refund?" }, resolve);
      });
      expect(ack.ok).toBe(true);

      const failed = await new Promise<{ error: { code: string } }>((resolve, reject) => {
        socket.on("ai:failed", resolve);
        socket.on("ai:completed", () => reject(new Error("expected ai:failed, got ai:completed")));
        setTimeout(() => reject(new Error("timed out waiting for ai:failed")), 10_000);
      });
      expect(failed.error.code).toBe("DAILY_CAP_EXCEEDED");
    } finally {
      socket.disconnect();
    }
  });

  it("completes the AI reply and settles the reservation on the unlimited BUSINESS plan", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("unlimited");
    await prisma.subscription.update({ where: { organizationId }, data: { plan: { connect: { code: "BUSINESS" } } } });
    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    const kbs = await request(baseUrl).get(`/api/orgs/${organizationId}/knowledge-bases`).set("Authorization", `Bearer ${ownerToken}`);
    await seedReadyDocument(organizationId, kbs.body[0].id, "Our refund policy allows a full refund within 30 days of purchase.");

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId: chatbot.body.id });
    const socket = await connectWidgetSocket(session.body.visitorToken);
    try {
      const completed = new Promise<void>((resolve, reject) => {
        socket.on("ai:completed", () => resolve());
        socket.on("ai:failed", (payload: { error: { code: string } }) => reject(new Error(`expected ai:completed, got ai:failed ${payload.error.code}`)));
        setTimeout(() => reject(new Error("timed out waiting for ai:completed")), 15_000);
      });
      socket.emit("message:send", { clientMessageId: randomUUID(), content: "How many days do I have to request a refund?" }, () => undefined);
      await completed;
    } finally {
      socket.disconnect();
    }

    const reservations = await prisma.tokenReservation.findMany({ where: { organizationId } });
    expect(reservations.map((r) => r.status)).toEqual(["RECONCILED"]);
    const counter = await prisma.usageCounter.findFirstOrThrow({ where: { organizationId } });
    expect(counter.aiTokensReserved).toBe(0n);
    expect(counter.aiTokensUsed).toBeGreaterThan(0n);
  });

  it("GET /api/orgs/:orgId/usage reports the current period's used/reserved/limit for the owner", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("usage-endpoint");
    const period = await currentPeriod(organizationId);
    await prisma.usageCounter.create({
      data: { organizationId, periodStart: period.periodStart, periodEnd: period.periodEnd, aiTokensUsed: 1_234, conversationsCount: 3 },
    });

    const res = await request(baseUrl).get(`/api/orgs/${organizationId}/usage`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.aiTokens).toMatchObject({ used: 1234, reserved: 0, limit: 50_000 });
    expect(res.body.conversations).toMatchObject({ used: 3, limit: 100 });
    expect(Array.isArray(res.body.chatbotsDaily)).toBe(true);
  });

  it("returns 403 for an AGENT requesting the usage endpoint (Owner/Admin only)", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("usage-rbac");
    const pro = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    await prisma.subscription.update({ where: { organizationId }, data: { planId: pro.id } });

    const agentEmail = uniqueEmail("usage-agent");
    const invite = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/invitations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: agentEmail, role: "AGENT" });
    const token = new URL(invite.body.inviteUrl).searchParams.get("token");
    const agentRegister = await request(baseUrl).post("/api/auth/register").send({ email: agentEmail, password: "Sup3rSecret!", name: "Agent" });
    const agentToken = agentRegister.body.accessToken as string;
    await request(baseUrl).post("/api/invitations/accept").set("Authorization", `Bearer ${agentToken}`).send({ token });

    const res = await request(baseUrl).get(`/api/orgs/${organizationId}/usage`).set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(403);
  });
});
