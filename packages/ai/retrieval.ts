// Section 5 "Runtime retrieval": pure decision logic shared by the API's live RAG pipeline and
// evals/run-eval.ts, so the eval measures the same behavior production actually uses. The SQL query
// itself (pgvector, tenant/status filters) stays in packages/database — Prisma can't express it.
import { DEFAULTS } from "@helpflow/config";
import type { RetrievedChunkRef } from "./citations";

export interface RetrievedRow {
  id: string;
  documentId: string;
  pageNumber: number | null;
  content: string;
  distance: number;
}

export interface NumberedContext extends RetrievedChunkRef {
  content: string;
  distance: number;
}

export interface RetrievalSelection {
  insufficientKnowledge: boolean;
  context: NumberedContext[];
}

/** Drops rows past maxCosineDistance, sorts ascending (smaller = closer — never invert this), and
 * numbers the survivors [1]..[K] for the prompt/citations. Empty result → insufficientKnowledge. */
export function selectContext(rows: RetrievedRow[], documentNameById: Map<string, string>): RetrievalSelection {
  const withinThreshold = rows.filter((r) => r.distance <= DEFAULTS.rag.maxCosineDistance).sort((a, b) => a.distance - b.distance);

  if (withinThreshold.length === 0) {
    return { insufficientKnowledge: true, context: [] };
  }

  const context = withinThreshold.map((row, i) => ({
    index: i + 1,
    chunkId: row.id,
    documentId: row.documentId,
    documentName: documentNameById.get(row.documentId) ?? "document",
    pageNumber: row.pageNumber,
    content: row.content,
    distance: row.distance,
  }));

  return { insufficientKnowledge: false, context };
}
