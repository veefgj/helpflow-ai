// Section 5 "Language" + "Conversational intents" and Section 7 T2-via-chat, over a real Socket.IO
// connection against the real AppModule, Postgres/pgvector and Redis. Run with AI_PROVIDER=fake
// (as CI does): the fake LLM never reads its prompt, so these tests assert routing, persistence and
// server-authored text — not model wording.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma, replaceDocumentChunks } from "@helpflow/database";
import { getEmbeddingProvider } from "@helpflow/ai";
import { t, type ConversationDto, type MessageDto } from "@helpflow/types";
import { createTestApp } from "./utils/create-test-app";

let app: INestApplication;
let baseUrl: string;
const organizationIds: string[] = [];

async function setupChatbot(label: string, knowledge?: string) {
  const owner = await request(baseUrl)
    .post("/api/auth/register")
    .send({ email: `${label}-${randomUUID().slice(0, 8)}@test.local`, password: "Sup3rSecret!", name: "Owner" });
  const ownerToken = owner.body.accessToken as string;
  const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: `${label} Co` });
  const organizationId = org.body.id as string;
  organizationIds.push(organizationId);
  const chatbot = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot" });

  if (knowledge) {
    const kbs = await request(baseUrl).get(`/api/orgs/${organizationId}/knowledge-bases`).set("Authorization", `Bearer ${ownerToken}`);
    const knowledgeBaseId = kbs.body[0].id as string;
    const document = await prisma.document.create({
      data: {
        organizationId,
        knowledgeBaseId,
        fileName: "kb.txt",
        type: "TXT",
        mimeType: "text/plain",
        sizeBytes: knowledge.length,
        checksumSha256: randomUUID(),
        storageKey: `test/${randomUUID()}.txt`,
        uploadedById: randomUUID(),
        status: "READY",
      },
    });
    const [embedded] = await getEmbeddingProvider().embed([knowledge]);
    await replaceDocumentChunks({
      documentId: document.id,
      organizationId,
      knowledgeBaseId,
      embeddingModel: getEmbeddingProvider().model,
      chunks: [{ chunkIndex: 0, pageNumber: null, content: knowledge, tokenCount: 20, embedding: embedded!.embedding }],
    });
  }

  return { ownerToken, organizationId, chatbotId: chatbot.body.id as string };
}

async function openWidget(chatbotId: string): Promise<Socket> {
  const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId });
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/widget`, { auth: { visitorToken: session.body.visitorToken }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function send(socket: Socket, content: string): Promise<{ ok: boolean; data?: { conversation: ConversationDto } }> {
  return new Promise((resolve) => socket.emit("message:send", { clientMessageId: randomUUID(), content }, resolve));
}

/** Sends a message and waits for the AI reply it triggers. */
async function ask(socket: Socket, content: string): Promise<{ conversation: ConversationDto; message: MessageDto }> {
  const completed = new Promise<MessageDto>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ai:completed after "${content}"`)), 10_000);
    socket.once("ai:completed", (payload: { message: MessageDto }) => {
      clearTimeout(timer);
      resolve(payload.message);
    });
  });
  const ack = await send(socket, content);
  expect(ack.ok).toBe(true);
  const message = await completed;
  const conversation = (await prisma.conversation.findUniqueOrThrow({ where: { id: message.conversationId } })) as unknown as ConversationDto;
  return { conversation, message };
}

async function retrievalOf(messageId: string) {
  return (await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).retrieval;
}

describe("Session language, conversational intents and chat handoff (Section 5 / Section 7)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const id of organizationIds) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it("fixes the language at T1, keeps it across languages, and localizes the no-knowledge fallback", async () => {
    const { chatbotId } = await setupChatbot("lang-t1");
    const socket = await openWidget(chatbotId);
    try {
      const first = await ask(socket, "công ty tên gì?");
      expect(first.conversation.language).toBe("vi");
      expect(first.message.insufficientKnowledge).toBe(true);
      expect(first.message.content).toBe(t("vi", "insufficientKnowledgeFallback"));

      // A later English message does not change the session language.
      const second = await ask(socket, "what is your company name?");
      expect(second.conversation.language).toBe("vi");
      expect(second.message.content).toBe(t("vi", "insufficientKnowledgeFallback"));
    } finally {
      socket.disconnect();
    }
  });

  it("switches language only on an explicit request, persists it, and can switch back", async () => {
    const { chatbotId } = await setupChatbot("lang-switch");
    const socket = await openWidget(chatbotId);
    try {
      await ask(socket, "xin chào");
      const updated = new Promise<ConversationDto>((resolve) => socket.once("conversation:updated", resolve));
      const switched = await ask(socket, "please reply in English");
      expect(switched.conversation.language).toBe("en");
      expect((await updated).language).toBe("en");
      expect(await retrievalOf(switched.message.id)).toEqual({ skipped: "social:language_switch" });

      expect((await ask(socket, "giá bao nhiêu?")).message.content).toBe(t("en", "insufficientKnowledgeFallback"));

      const back = await ask(socket, "trả lời bằng tiếng việt");
      expect(back.conversation.language).toBe("vi");
    } finally {
      socket.disconnect();
    }
  });

  it("uses the chatbot's defaultLanguage when the first message is ambiguous", async () => {
    const { chatbotId, organizationId, ownerToken } = await setupChatbot("lang-default");
    const patch = await request(baseUrl)
      .patch(`/api/orgs/${organizationId}/chatbots/${chatbotId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ defaultLanguage: "en" });
    expect(patch.body.defaultLanguage).toBe("en");

    const session = await request(baseUrl).post("/api/widget/session").send({ chatbotId });
    expect(session.body.config.defaultLanguage).toBe("en");

    const socket = await openWidget(chatbotId);
    try {
      expect((await ask(socket, "ok")).conversation.language).toBe("en");
    } finally {
      socket.disconnect();
    }
  });

  it("answers pure small talk without retrieval or citations, even when the KB has knowledge", async () => {
    const { chatbotId } = await setupChatbot("social", "Chính sách hoàn tiền: khách hàng được hoàn tiền trong vòng 30 ngày.");
    const socket = await openWidget(chatbotId);
    try {
      const greeting = await ask(socket, "xin chào");
      expect(greeting.message.citations).toEqual([]);
      expect(greeting.message.insufficientKnowledge).toBe(false);
      expect(await retrievalOf(greeting.message.id)).toEqual({ skipped: "social:greeting" });
    } finally {
      socket.disconnect();
    }
  });

  it("runs RAG for a greeting combined with a business question", async () => {
    const { chatbotId } = await setupChatbot("mixed", "Chính sách hoàn tiền: khách hàng được hoàn tiền trong vòng 30 ngày.");
    const socket = await openWidget(chatbotId);
    try {
      const mixed = await ask(socket, "xin chào, hoàn tiền trong bao lâu?");
      expect(Array.isArray(await retrievalOf(mixed.message.id))).toBe(true); // retrieval ran, not the social path
      expect(mixed.message.citations?.length).toBeGreaterThan(0);
    } finally {
      socket.disconnect();
    }
  });

  it("hands off when the customer says yes to the AI's offer, with a localized SYSTEM message and no AI reply", async () => {
    const { chatbotId } = await setupChatbot("consent");
    const socket = await openWidget(chatbotId);
    try {
      const offer = await ask(socket, "có bán thẻ quà tặng không?");
      expect(offer.message.insufficientKnowledge).toBe(true);

      let aiStarted = false;
      socket.on("ai:started", () => (aiStarted = true));
      const systemMessage = new Promise<MessageDto>((resolve) =>
        socket.on("message:created", (m: MessageDto) => {
          if (m.senderType === "SYSTEM") resolve(m);
        }),
      );
      const ack = await send(socket, "có");
      expect(ack.data?.conversation.status).toBe("WAITING_AGENT");
      expect((await systemMessage).content).toBe(t("vi", "handoffRequested"));
      await new Promise((r) => setTimeout(r, 300));
      expect(aiStarted).toBe(false);
    } finally {
      socket.disconnect();
    }
  });

  it("treats a bare 'yes' without a prior offer as a normal message, and an explicit request as a handoff any time", async () => {
    const { chatbotId } = await setupChatbot("explicit");
    const socket = await openWidget(chatbotId);
    try {
      const plain = await ask(socket, "ok");
      expect(plain.conversation.status).toBe("AI_ACTIVE");

      const ack = await send(socket, "I want to talk to a human");
      expect(ack.data?.conversation.status).toBe("WAITING_AGENT");
    } finally {
      socket.disconnect();
    }
  });
});
