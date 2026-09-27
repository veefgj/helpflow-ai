// Raw SQL only — Prisma cannot read/write the `vector` column type (ADR-004). Every query here
// filters by organizationId; callers never pass this repository an unscoped query.
import { prisma } from "../client";

export interface ChunkToInsert {
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  tokenCount: number;
  embedding: number[];
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Section 5 "Embed + persist": delete existing chunks of the document, then insert all chunks in
 * one transaction — re-runs (e.g. after a retry) are idempotent. */
export async function replaceDocumentChunks(params: {
  documentId: string;
  organizationId: string;
  knowledgeBaseId: string;
  embeddingModel: string;
  chunks: ChunkToInsert[];
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM document_chunks WHERE "documentId" = ${params.documentId}`;
    for (const chunk of params.chunks) {
      await tx.$executeRaw`
        INSERT INTO document_chunks
          (id, "organizationId", "knowledgeBaseId", "documentId", "chunkIndex", "pageNumber", content, "tokenCount", embedding, "embeddingModel", "createdAt")
        VALUES
          (gen_random_uuid(), ${params.organizationId}, ${params.knowledgeBaseId}, ${params.documentId}, ${chunk.chunkIndex}, ${chunk.pageNumber},
           ${chunk.content}, ${chunk.tokenCount}, ${toVectorLiteral(chunk.embedding)}::vector, ${params.embeddingModel}, now())
      `;
    }
  });
}

export interface RetrievedRow {
  id: string;
  documentId: string;
  pageNumber: number | null;
  chunkIndex: number;
  content: string;
  distance: number;
}

/** Appendix B Q1. Distance: 0 = identical, larger = less similar; callers drop rows above
 * maxCosineDistance themselves (kept out of SQL so the raw distance is available for eval/debug). */
export async function retrieveChunks(params: {
  organizationId: string;
  knowledgeBaseIds: string[];
  queryEmbedding: number[];
  topK: number;
}): Promise<RetrievedRow[]> {
  if (params.knowledgeBaseIds.length === 0) return [];
  const vectorLiteral = toVectorLiteral(params.queryEmbedding);

  const rows = await prisma.$queryRaw<RetrievedRow[]>`
    SELECT c.id, c."documentId", c."pageNumber", c."chunkIndex", c.content,
           (c.embedding <=> ${vectorLiteral}::vector) AS distance
    FROM document_chunks c
    JOIN documents d ON d.id = c."documentId"
    WHERE c."organizationId" = ${params.organizationId}
      AND c."knowledgeBaseId" = ANY(${params.knowledgeBaseIds}::text[])
      AND d.status = 'READY' AND d."disabledReason" IS NULL AND d."deletedAt" IS NULL
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${params.topK}
  `;
  return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
}

export async function deleteChunksForDocument(documentId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM document_chunks WHERE "documentId" = ${documentId}`;
}
