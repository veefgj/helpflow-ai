// Phase 2 acceptance criterion (Section 13): "widget question → grounded streamed answer with
// validated citation." Exercised over a real Socket.IO connection against the real AppModule,
// real Postgres/pgvector and Redis, with a document pre-seeded as READY (the worker's own ingestion
// pipeline is covered separately in apps/worker's integration tests).
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma, replaceDocumentChunks } from "@helpflow/database";
import { getEmbeddingProvider } from "@helpflow/ai";
import { createTestApp } from "./utils/create-test-app";

let app: INestApplication;
let baseUrl: string;
let organizationId: string;

async function seedReadyDocument(knowledgeBaseId: string, content: string) {
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
  return document;
}

function connectWidgetSocket(visitorToken: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/widget`, { auth: { visitorToken }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

describe("Widget RAG Q&A over Socket.IO (Phase 2)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    await app.close();
  });

  it("answers a question with a grounded, cited response when the knowledge base has a matching chunk", async () => {
    const owner = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email: `rag-${randomUUID().slice(0, 8)}@test.local`, password: "Sup3rSecret!", name: "RAG Owner" });
    const ownerToken = owner.body.accessToken as string;

    const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "RAG Co" });
    organizationId = org.body.id;

    const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });
    const kbs = await request(baseUrl).get(`/api/orgs/${organizationId}/knowledge-bases`).set("Authorization", `Bearer ${ownerToken}`);
    const knowledgeBaseId = kbs.body[0].id as string;

    await seedReadyDocument(knowledgeBaseId, "Our refund policy allows a full refund within 30 days of purchase.");

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId: chatbot.body.id });
    expect(session.status).toBe(201);

    const socket = await connectWidgetSocket(session.body.visitorToken);
    try {
      const ack = await new Promise<{ ok: boolean; data?: { conversation: { status: string } } }>((resolve) => {
        socket.emit(
          "message:send",
          { clientMessageId: randomUUID(), content: "How many days do I have to request a refund?" },
          resolve,
        );
      });
      expect(ack.ok).toBe(true);
      expect(ack.data?.conversation.status).toBe("AI_ACTIVE");

      const completed = await new Promise<{ message: { content: string; citations: Array<{ index: number }>; insufficientKnowledge: boolean } }>(
        (resolve, reject) => {
          socket.on("ai:completed", resolve);
          socket.on("ai:failed", reject);
          setTimeout(() => reject(new Error("timed out waiting for ai:completed")), 10_000);
        },
      );

      expect(completed.message.insufficientKnowledge).toBe(false);
      expect(completed.message.citations.length).toBeGreaterThan(0);
      expect(completed.message.citations[0]).toMatchObject({ index: 1 });
    } finally {
      socket.disconnect();
    }
  });

  it("falls back to insufficientKnowledge when no chunk is a close enough match", async () => {
    const owner = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email: `rag-empty-${randomUUID().slice(0, 8)}@test.local`, password: "Sup3rSecret!", name: "Empty Owner" });
    const ownerToken = owner.body.accessToken as string;

    const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Empty KB Co" });
    const chatbot = await request(baseUrl).post(`/api/orgs/${org.body.id}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId: chatbot.body.id });
    const socket = await connectWidgetSocket(session.body.visitorToken);
    try {
      const completed = await new Promise<{ message: { insufficientKnowledge: boolean; citations: unknown[] } }>((resolve, reject) => {
        socket.emit("message:send", { clientMessageId: randomUUID(), content: "What is your refund policy?" }, () => undefined);
        socket.on("ai:completed", resolve);
        socket.on("ai:failed", reject);
        setTimeout(() => reject(new Error("timed out waiting for ai:completed")), 10_000);
      });
      expect(completed.message.insufficientKnowledge).toBe(true);
      expect(completed.message.citations).toEqual([]);
    } finally {
      socket.disconnect();
      await prisma.organization.delete({ where: { id: org.body.id } }).catch(() => undefined);
    }
  });
});
