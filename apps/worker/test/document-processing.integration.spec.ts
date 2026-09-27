// Section 5 "Document ingestion" exercised for real: a real Postgres/pgvector, real S3-compatible
// storage, and the actual worker pipeline (parse → chunk → embed → persist → READY).
import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@helpflow/database";
import { putObject } from "@helpflow/storage";
import { processDocument } from "../src/queues/document-processing.worker";

const suffix = randomUUID().slice(0, 8);
let organizationId: string;
let knowledgeBaseId: string;

function fakeJob(documentId: string): Job<{ documentId: string }> {
  return { data: { documentId } } as Job<{ documentId: string }>;
}

async function setupOrgAndKb() {
  const org = await prisma.organization.create({ data: { name: `Ingest test ${suffix}`, slug: `ingest-test-${suffix}` } });
  const kb = await prisma.knowledgeBase.create({ data: { organizationId: org.id, name: "Test KB" } });
  return { organizationId: org.id, knowledgeBaseId: kb.id };
}

describe("document-processing worker (Section 5)", () => {
  it("sets up an org + knowledge base fixture", async () => {
    ({ organizationId, knowledgeBaseId } = await setupOrgAndKb());
    expect(organizationId).toBeTruthy();
  });

  it("parses, chunks, embeds and marks a TXT document READY", async () => {
    const content = "HelpFlow AI Refund Policy.\n\nCustomers may request a full refund within 30 days of purchase.";
    const storageKey = `test/${randomUUID()}.txt`;
    await putObject(storageKey, Buffer.from(content, "utf-8"), "text/plain");

    const document = await prisma.document.create({
      data: {
        organizationId,
        knowledgeBaseId,
        fileName: "refund-policy.txt",
        type: "TXT",
        mimeType: "text/plain",
        sizeBytes: content.length,
        checksumSha256: randomUUID(),
        storageKey,
        uploadedById: randomUUID(),
      },
    });

    await processDocument(fakeJob(document.id));

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(updated.status).toBe("READY");
    expect(updated.pageCount).toBeNull();
    expect(updated.processedAt).not.toBeNull();

    const chunks = await prisma.$queryRaw<Array<{ content: string; dims: number }>>`
      SELECT content, vector_dims(embedding) AS dims FROM document_chunks WHERE "documentId" = ${document.id}
    `;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.dims).toBe(1536);
    expect(chunks[0]!.content).toContain("refund");

    const usage = await prisma.aiUsage.findFirst({ where: { documentId: document.id, usageType: "EMBEDDING_INGEST" } });
    expect(usage).not.toBeNull();
  });

  it("marks a document FAILED with NO_TEXT_EXTRACTED for an empty TXT file — no retry needed", async () => {
    const storageKey = `test/${randomUUID()}.txt`;
    await putObject(storageKey, Buffer.from("   \n\n  ", "utf-8"), "text/plain");

    const document = await prisma.document.create({
      data: {
        organizationId,
        knowledgeBaseId,
        fileName: "empty.txt",
        type: "TXT",
        mimeType: "text/plain",
        sizeBytes: 4,
        checksumSha256: randomUUID(),
        storageKey,
        uploadedById: randomUUID(),
      },
    });

    await processDocument(fakeJob(document.id));

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.errorCode).toBe("NO_TEXT_EXTRACTED");
    expect(updated.attempts).toBe(1);
  });

  it("re-running processDocument on the same document is idempotent (re-runs replace, not duplicate, chunks)", async () => {
    const content = "Idempotency check: refund window is thirty days.";
    const storageKey = `test/${randomUUID()}.txt`;
    await putObject(storageKey, Buffer.from(content, "utf-8"), "text/plain");

    const document = await prisma.document.create({
      data: {
        organizationId,
        knowledgeBaseId,
        fileName: "idempotent.txt",
        type: "TXT",
        mimeType: "text/plain",
        sizeBytes: content.length,
        checksumSha256: randomUUID(),
        storageKey,
        uploadedById: randomUUID(),
      },
    });

    await processDocument(fakeJob(document.id));
    await processDocument(fakeJob(document.id));

    const chunkCount = await prisma.documentChunk.count({ where: { documentId: document.id } });
    expect(chunkCount).toBe(1);
  });
});

afterAll(async () => {
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});
