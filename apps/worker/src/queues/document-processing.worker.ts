// Section 5 "Document ingestion": parse → chunk → embed → persist → READY. Transient failures
// (storage/embedding) rethrow so BullMQ's own attempts+backoff retries the job; parse-time failures
// (encrypted, too many pages, no text) are non-retryable and fail the document immediately.
import { Job, Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { prisma, replaceDocumentChunks, type ChunkToInsert } from "@helpflow/database";
import { chunkPages, getEmbeddingProvider } from "@helpflow/ai";
import { getObjectBuffer } from "@helpflow/storage";
import { DocumentErrorCode } from "@helpflow/types";
import { createRedisConnection } from "../redis";
import { extractPages, pageCountOf, NonRetryableIngestionError } from "./document-processing/extract-pages";

interface DocumentProcessingJobData {
  documentId: string;
}

async function markRetryableFailure(documentId: string, code: DocumentErrorCode): Promise<void> {
  await prisma.document.update({ where: { id: documentId }, data: { errorCode: code, attempts: { increment: 1 } } });
}

export async function processDocument(job: Job<DocumentProcessingJobData>): Promise<void> {
  const document = await prisma.document.findUnique({ where: { id: job.data.documentId } });
  if (!document || document.deletedAt) return; // removed before the job ran — nothing to do

  await prisma.document.update({ where: { id: document.id }, data: { status: "PROCESSING" } });

  let buffer: Buffer;
  try {
    buffer = await getObjectBuffer(document.storageKey);
  } catch (err) {
    await markRetryableFailure(document.id, DocumentErrorCode.STORAGE_READ_FAILED);
    throw err;
  }

  let pages;
  try {
    pages = await extractPages(buffer, document.type);
  } catch (err) {
    if (err instanceof NonRetryableIngestionError) {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "FAILED", errorCode: err.code, attempts: { increment: 1 } },
      });
      return;
    }
    throw err;
  }

  const chunks = chunkPages(pages, { chunkTokens: DEFAULTS.rag.chunkTokens, overlapTokens: DEFAULTS.rag.chunkOverlapTokens });
  const provider = getEmbeddingProvider();
  const toInsert: ChunkToInsert[] = [];
  let totalEmbeddingTokens = 0;

  try {
    for (let i = 0; i < chunks.length; i += DEFAULTS.ingestion.embeddingBatchSize) {
      const batch = chunks.slice(i, i + DEFAULTS.ingestion.embeddingBatchSize);
      const results = await provider.embed(batch.map((c) => c.content));
      results.forEach((result, idx) => {
        const chunk = batch[idx]!;
        toInsert.push({
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: result.embedding,
        });
        totalEmbeddingTokens += result.tokens;
      });
    }
  } catch (err) {
    await markRetryableFailure(document.id, DocumentErrorCode.EMBEDDING_FAILED);
    throw err;
  }

  await replaceDocumentChunks({
    documentId: document.id,
    organizationId: document.organizationId,
    knowledgeBaseId: document.knowledgeBaseId,
    embeddingModel: provider.model,
    chunks: toInsert,
  });

  await prisma.aiUsage.create({
    data: {
      organizationId: document.organizationId,
      documentId: document.id,
      usageType: "EMBEDDING_INGEST",
      model: provider.model,
      inputTokens: totalEmbeddingTokens,
      outputTokens: 0,
      totalTokens: totalEmbeddingTokens,
      estimatedCostMicros: BigInt(Math.round((totalEmbeddingTokens / 1_000_000) * DEFAULTS.pricing.perMillionEmbedding)),
    },
  });

  await prisma.document.update({
    where: { id: document.id },
    data: { status: "READY", errorCode: null, pageCount: pageCountOf(pages, document.type), processedAt: new Date() },
  });
}

export function startDocumentProcessingWorker(): Worker {
  const worker = new Worker<DocumentProcessingJobData>(DEFAULTS.jobs.queues.documentProcessing, processDocument, {
    connection: createRedisConnection(),
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!isFinalAttempt) return;
    console.error(`document-processing: final failure for document ${job.data.documentId}`, err);
    await prisma.document
      .update({ where: { id: job.data.documentId }, data: { status: "FAILED" } })
      .catch(() => undefined);
  });

  return worker;
}
