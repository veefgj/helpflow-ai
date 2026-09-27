// Thin Nest wrapper: resolves the chatbot's attached knowledge bases, embeds the question, runs the
// raw SQL vector query (packages/database), then hands off to the pure selectContext() decision
// logic in packages/ai — the same logic evals/run-eval.ts uses, so the eval measures real behavior.
import { Injectable } from "@nestjs/common";
import { prisma, retrieveChunks } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { getEmbeddingProvider, selectContext, type RetrievalSelection } from "@helpflow/ai";

@Injectable()
export class RetrievalService {
  async retrieve(organizationId: string, chatbotId: string, question: string): Promise<RetrievalSelection> {
    const links = await prisma.chatbotKnowledgeBase.findMany({ where: { chatbotId }, select: { knowledgeBaseId: true } });
    const knowledgeBaseIds = links.map((l) => l.knowledgeBaseId);
    if (knowledgeBaseIds.length === 0) {
      return { insufficientKnowledge: true, context: [] };
    }

    const [embedded] = await getEmbeddingProvider().embed([question]);
    if (!embedded) {
      return { insufficientKnowledge: true, context: [] };
    }
    const rows = await retrieveChunks({ organizationId, knowledgeBaseIds, queryEmbedding: embedded.embedding, topK: DEFAULTS.rag.topK });

    const documentIds = [...new Set(rows.map((r) => r.documentId))];
    const documents = await prisma.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, fileName: true } });
    const documentNameById = new Map(documents.map((d) => [d.id, d.fileName]));

    return selectContext(rows, documentNameById);
  }
}
