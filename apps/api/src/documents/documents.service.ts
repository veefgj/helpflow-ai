import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { prisma } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { buildDocumentStorageKey, deleteObject, putObject } from "@helpflow/storage";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { DOCUMENT_PROCESSING_QUEUE } from "../common/queues/queues.module";
import { QuotaService } from "../quota/quota.service";
import { assertFileSize, detectDocumentType, validateMagicBytes } from "./upload-validation";

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DOCUMENT_PROCESSING_QUEUE) private readonly queue: Queue,
    @Inject(QuotaService) private readonly quota: QuotaService,
  ) {}

  async upload(organizationId: string, knowledgeBaseId: string, uploadedById: string, file: Express.Multer.File) {
    await this.requireKnowledgeBase(organizationId, knowledgeBaseId);
    await this.quota.assertResourceLimit(organizationId, "documents");

    assertFileSize(file.size);
    const type = detectDocumentType(file.originalname, file.mimetype);
    validateMagicBytes(file.buffer, type);

    const checksumSha256 = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await prisma.document.findUnique({
      where: { knowledgeBaseId_checksumSha256: { knowledgeBaseId, checksumSha256 } },
    });
    if (existing) {
      throw new HelpFlowApiException(ApiErrorCode.DUPLICATE_RESOURCE, "This file has already been uploaded to this knowledge base");
    }

    const document = await prisma.document.create({
      data: {
        organizationId,
        knowledgeBaseId,
        fileName: file.originalname,
        type,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksumSha256,
        storageKey: "pending", // replaced below once we know the document id
        uploadedById,
      },
    });

    const storageKey = buildDocumentStorageKey({
      organizationId,
      knowledgeBaseId,
      documentId: document.id,
      sha256: checksumSha256,
      extension: extname(file.originalname).toLowerCase(),
    });
    await putObject(storageKey, file.buffer, file.mimetype);
    const updated = await prisma.document.update({ where: { id: document.id }, data: { storageKey } });

    await this.enqueue(document.id);
    return updated;
  }

  async list(organizationId: string, knowledgeBaseId: string) {
    await this.requireKnowledgeBase(organizationId, knowledgeBaseId);
    return prisma.document.findMany({
      where: { organizationId, knowledgeBaseId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async retry(organizationId: string, documentId: string): Promise<void> {
    const doc = await this.requireDocument(organizationId, documentId);
    if (doc.status !== "FAILED") {
      throw new HelpFlowApiException(ApiErrorCode.INVALID_STATE_TRANSITION, "Only a FAILED document can be retried");
    }
    await prisma.document.update({ where: { id: documentId }, data: { status: "UPLOADED", errorCode: null } });
    await this.enqueue(documentId);
  }

  /** Two-phase delete (Section 4): hidden from retrieval immediately; chunks/object/row purged
   * best-effort here and retried by the maintenance job if any step fails. */
  async remove(organizationId: string, documentId: string): Promise<void> {
    const doc = await this.requireDocument(organizationId, documentId);
    await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

    try {
      await prisma.documentChunk.deleteMany({ where: { documentId } });
      await deleteObject(doc.storageKey);
      await prisma.document.delete({ where: { id: documentId } });
    } catch {
      // left for the maintenance worker to retry — the document is already hidden via deletedAt.
    }
  }

  private async enqueue(documentId: string): Promise<void> {
    await this.queue.add(
      "parse",
      { documentId },
      {
        jobId: documentId,
        attempts: DEFAULTS.ingestion.attempts,
        backoff: { type: "exponential", delay: DEFAULTS.ingestion.backoff.delayMs },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  private async requireKnowledgeBase(organizationId: string, knowledgeBaseId: string) {
    const kb = await prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!kb || kb.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Knowledge base not found");
    }
    return kb;
  }

  private async requireDocument(organizationId: string, documentId: string) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Document not found");
    }
    return doc;
  }
}
