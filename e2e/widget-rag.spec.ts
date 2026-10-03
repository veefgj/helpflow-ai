// Section 13 Definition of Done: "widget question → grounded streamed answer with validated
// citation" — the one path in the spec that names an actual browser. Everything else in this
// project is covered by vitest integration tests that talk the same protocols (HTTP, Socket.IO)
// without rendering the React widget UI; this test is the one place that UI code (chat-widget.tsx)
// actually gets exercised in a browser. Setup (org/chatbot/document/embedding) goes straight
// through Prisma, the same way the vitest widget-rag.integration.spec.ts seeds its fixtures —
// only the customer-facing question/answer step drives a real browser.
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma, replaceDocumentChunks } from "@helpflow/database";
import { getEmbeddingProvider } from "@helpflow/ai";

const API_URL = "http://localhost:4000";
let organizationId: string;
let chatbotId: string;

test.beforeAll(async () => {
  const email = `e2e-${randomUUID().slice(0, 8)}@test.local`;
  const register = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Sup3rSecret!", name: "E2E Owner" }),
  });
  const { accessToken } = (await register.json()) as { accessToken: string };

  const orgRes = await fetch(`${API_URL}/api/orgs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name: "E2E Co" }),
  });
  const org = (await orgRes.json()) as { id: string };
  organizationId = org.id;

  const chatbotRes = await fetch(`${API_URL}/api/orgs/${organizationId}/chatbots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name: "E2E Bot" }),
  });
  const chatbot = (await chatbotRes.json()) as { id: string };
  chatbotId = chatbot.id;
  // English scenario: widget chrome follows the chatbot's default language until the session's is set.
  await fetch(`${API_URL}/api/orgs/${organizationId}/chatbots/${chatbotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ defaultLanguage: "en" }),
  });

  const kbRes = await fetch(`${API_URL}/api/orgs/${organizationId}/knowledge-bases`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const [kb] = (await kbRes.json()) as Array<{ id: string }>;

  const content = "Our refund policy allows a full refund within 30 days of purchase.";
  const document = await prisma.document.create({
    data: {
      organizationId,
      knowledgeBaseId: kb!.id,
      fileName: "seed.txt",
      type: "TXT",
      mimeType: "text/plain",
      sizeBytes: content.length,
      checksumSha256: randomUUID(),
      storageKey: `e2e/${randomUUID()}.txt`,
      uploadedById: randomUUID(),
      status: "READY",
    },
  });
  const [embedded] = await getEmbeddingProvider().embed([content]);
  await replaceDocumentChunks({
    documentId: document.id,
    organizationId,
    knowledgeBaseId: kb!.id,
    embeddingModel: getEmbeddingProvider().model,
    chunks: [{ chunkIndex: 0, pageNumber: 1, content, tokenCount: 20, embedding: embedded!.embedding }],
  });
});

test.afterAll(async () => {
  if (organizationId) await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
});

test("a customer asks a question in the widget and sees a grounded, cited answer render live", async ({ page }) => {
  await page.goto(`/c/${chatbotId}`);

  const input = page.getByPlaceholder("Ask a question…");
  await expect(input).toBeEnabled({ timeout: 15_000 }); // socket connected

  await input.fill("How many days do I have to request a refund?");
  await page.getByRole("button", { name: "Send" }).click();

  // The customer's own message renders immediately.
  await expect(page.getByText("How many days do I have to request a refund?")).toBeVisible();

  // The streamed AI answer completes and includes a citation back to the seeded document.
  await expect(page.getByText("seed.txt", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/refund/i).last()).toBeVisible();
});
