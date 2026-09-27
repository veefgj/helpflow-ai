// Builds the fixed knowledge base that evals/rag-gold.jsonl's questions are written against.
// Re-runnable: deletes any previous "eval-fixtures" org before recreating it, so `pnpm eval:rag`
// always starts from a known corpus regardless of AI_PROVIDER (fake or openai). Env vars come from
// `--env-file-if-exists` (package.json), loaded by Node before this module graph evaluates.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, replaceDocumentChunks } from "@helpflow/database";
import { chunkPages, getEmbeddingProvider } from "@helpflow/ai";
import { DEFAULTS } from "@helpflow/config";

const EVAL_ORG_SLUG = "eval-fixtures";
const CORPUS_DIR = join(__dirname, "corpus");
const CORPUS = ["refund-policy", "shipping-policy", "account-deletion"] as const;

export interface EvalFixtures {
  organizationId: string;
  chatbotId: string;
  knowledgeBaseId: string;
  documents: Record<(typeof CORPUS)[number], string>;
}

export async function seedEvalCorpus(): Promise<EvalFixtures> {
  const existing = await prisma.organization.findUnique({ where: { slug: EVAL_ORG_SLUG } });
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const org = await prisma.organization.create({ data: { name: "Eval Fixtures", slug: EVAL_ORG_SLUG } });
  const kb = await prisma.knowledgeBase.create({ data: { organizationId: org.id, name: "Eval KB" } });
  const chatbot = await prisma.chatbot.create({ data: { organizationId: org.id, name: "Eval Bot", allowedDomains: [] } });
  await prisma.chatbotKnowledgeBase.create({ data: { chatbotId: chatbot.id, knowledgeBaseId: kb.id, organizationId: org.id } });

  const provider = getEmbeddingProvider();
  const documents: Partial<Record<(typeof CORPUS)[number], string>> = {};

  for (const key of CORPUS) {
    const text = readFileSync(join(CORPUS_DIR, `${key}.txt`), "utf-8");
    const document = await prisma.document.create({
      data: {
        organizationId: org.id,
        knowledgeBaseId: kb.id,
        fileName: `${key}.txt`,
        type: "TXT",
        mimeType: "text/plain",
        sizeBytes: text.length,
        checksumSha256: key,
        storageKey: `eval/${key}.txt`,
        uploadedById: "eval-seed-script",
        status: "READY",
        processedAt: new Date(),
      },
    });

    const chunks = chunkPages([{ pageNumber: null, text }], { chunkTokens: DEFAULTS.rag.chunkTokens, overlapTokens: DEFAULTS.rag.chunkOverlapTokens });
    const embeddings = await provider.embed(chunks.map((c) => c.content));
    await replaceDocumentChunks({
      documentId: document.id,
      organizationId: org.id,
      knowledgeBaseId: kb.id,
      embeddingModel: provider.model,
      chunks: chunks.map((c, i) => ({ ...c, embedding: embeddings[i]!.embedding })),
    });

    documents[key] = document.id;
  }

  const fixtures: EvalFixtures = {
    organizationId: org.id,
    chatbotId: chatbot.id,
    knowledgeBaseId: kb.id,
    documents: documents as Record<(typeof CORPUS)[number], string>,
  };
  writeFileSync(join(__dirname, ".eval-fixtures.json"), JSON.stringify(fixtures, null, 2));
  return fixtures;
}

if (require.main === module) {
  seedEvalCorpus()
    .then((fixtures) => {
      console.log("Eval fixtures ready:", fixtures);
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
