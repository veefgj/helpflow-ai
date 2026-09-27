// HelpFlow AI — RAG evaluation runner (Section 5 "RAG evaluation", Phase 2 deliverable).
// Reads evals/rag-gold.jsonl, re-seeds the fixed eval knowledge base (evals/seed-eval-corpus.ts),
// and reports Hit@5, citation correctness, faithfulness (LLM-judged) and the correct-refusal rate —
// using the exact same retrieval/prompt/citation logic apps/api uses in production (packages/ai).
// Env vars come from `--env-file-if-exists` (package.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, retrieveChunks } from "@helpflow/database";
import { DEFAULTS, loadEnv } from "@helpflow/config";
import {
  buildChatMessages,
  getEmbeddingProvider,
  getLlmProvider,
  parseTrailer,
  selectContext,
  validateCitations,
  type RetrievedRow,
} from "@helpflow/ai";
import { seedEvalCorpus, type EvalFixtures } from "./seed-eval-corpus";

interface GoldQuestion {
  question: string;
  expectedDocumentKey: keyof EvalFixtures["documents"] | null;
  expectedPage: number | null;
  expectedFacts: string[];
  answerable: boolean;
}

interface QuestionResult {
  question: GoldQuestion;
  hit5: boolean | null; // null = not applicable (unanswerable question)
  insufficientKnowledge: boolean;
  correctRefusal: boolean | null; // for unanswerable: did we refuse? for answerable: did we wrongly refuse?
  citationCorrect: boolean | null;
  faithfulFacts: number | null;
  totalFacts: number;
  topDistance: number | null;
}

function loadGoldSet(): GoldQuestion[] {
  const raw = readFileSync(join(__dirname, "rag-gold.jsonl"), "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GoldQuestion);
}

async function judgeFact(answer: string, fact: string): Promise<boolean> {
  const provider = getLlmProvider();
  let text = "";
  const result = await provider.streamChatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You are grading a customer support answer. Reply with exactly one word, YES or NO: does the ANSWER clearly state the FACT? Do not explain.",
      },
      { role: "user", content: `FACT: ${fact}\n\nANSWER: ${answer}` },
    ],
    maxTokens: 5,
    temperature: 0,
    onChunk: (delta) => {
      text += delta;
    },
  });
  return /yes/i.test(result.content || text);
}

async function evaluateQuestion(fixtures: EvalFixtures, q: GoldQuestion): Promise<QuestionResult> {
  const [embedded] = await getEmbeddingProvider().embed([q.question]);
  const rows: RetrievedRow[] = embedded
    ? await retrieveChunks({
        organizationId: fixtures.organizationId,
        knowledgeBaseIds: [fixtures.knowledgeBaseId],
        queryEmbedding: embedded.embedding,
        topK: 5,
      })
    : [];

  const expectedDocumentId = q.expectedDocumentKey ? fixtures.documents[q.expectedDocumentKey] : null;
  const hit5 = q.answerable && expectedDocumentId ? rows.some((r) => r.documentId === expectedDocumentId) : null;
  const topDistance = rows[0]?.distance ?? null;

  const documents = await prisma.document.findMany({ where: { organizationId: fixtures.organizationId }, select: { id: true, fileName: true } });
  const documentNameById = new Map(documents.map((d) => [d.id, d.fileName]));
  const { insufficientKnowledge, context } = selectContext(rows, documentNameById);

  if (insufficientKnowledge) {
    return {
      question: q,
      hit5,
      insufficientKnowledge: true,
      correctRefusal: q.answerable ? false : true,
      citationCorrect: null,
      faithfulFacts: null,
      totalFacts: q.expectedFacts.length,
      topDistance,
    };
  }

  const messages = buildChatMessages({ tenantSystemPrompt: null, context, history: [], customerMessage: q.question });
  let fullText = "";
  await getLlmProvider().streamChatCompletion({
    messages,
    maxTokens: 400,
    temperature: 0,
    onChunk: (delta) => {
      fullText += delta;
    },
  });
  const { answerText, citations } = parseTrailer(fullText);
  const validated = validateCitations(citations, context);

  const citationCorrect = q.answerable && expectedDocumentId ? validated.some((c) => c.documentId === expectedDocumentId) : null;

  let faithfulFacts: number | null = null;
  if (q.expectedFacts.length > 0) {
    const judged = await Promise.all(q.expectedFacts.map((fact) => judgeFact(answerText, fact)));
    faithfulFacts = judged.filter(Boolean).length;
  }

  return {
    question: q,
    hit5,
    insufficientKnowledge: false,
    correctRefusal: q.answerable ? true : false, // answered when it should have refused, or vice versa
    citationCorrect,
    faithfulFacts,
    totalFacts: q.expectedFacts.length,
    topDistance,
  };
}

function rate(nums: boolean[]): string {
  if (nums.length === 0) return "n/a";
  return `${((nums.filter(Boolean).length / nums.length) * 100).toFixed(1)}% (${nums.filter(Boolean).length}/${nums.length})`;
}

async function main() {
  const env = loadEnv();
  if (env.AI_PROVIDER === "fake") {
    console.warn(
      "⚠ AI_PROVIDER=fake — Hit@5 and correct-refusal are meaningful, but citation-correctness and\n" +
        "  faithfulness numbers below are NOT a real quality signal (the fake LLM doesn't read the\n" +
        "  knowledge it's given). Set AI_PROVIDER=openai and a real OPENAI_API_KEY for a real report.\n",
    );
  }

  console.log("→ seeding eval corpus…");
  const fixtures = await seedEvalCorpus();

  const gold = loadGoldSet();
  console.log(`→ evaluating ${gold.length} questions…`);
  const results: QuestionResult[] = [];
  for (const q of gold) {
    results.push(await evaluateQuestion(fixtures, q));
  }

  const answerable = results.filter((r) => r.question.answerable);
  const unanswerable = results.filter((r) => !r.question.answerable);
  const distances = results.map((r) => r.topDistance).filter((d): d is number => d !== null).sort((a, b) => a - b);

  console.log("\n=== HelpFlow RAG eval report ===");
  console.log(`Questions: ${results.length} (${answerable.length} answerable, ${unanswerable.length} unanswerable)`);
  console.log(`Hit@5:                ${rate(answerable.map((r) => r.hit5 === true))}`);
  console.log(`Citation correctness: ${rate(answerable.filter((r) => r.citationCorrect !== null).map((r) => r.citationCorrect === true))}`);
  const faithfulnessRows = results.filter((r) => r.totalFacts > 0 && r.faithfulFacts !== null);
  const totalFacts = faithfulnessRows.reduce((sum, r) => sum + r.totalFacts, 0);
  const totalFaithful = faithfulnessRows.reduce((sum, r) => sum + (r.faithfulFacts ?? 0), 0);
  console.log(`Faithfulness:         ${totalFacts ? `${((totalFaithful / totalFacts) * 100).toFixed(1)}% (${totalFaithful}/${totalFacts} facts)` : "n/a"}`);
  console.log(`Correct-refusal rate: ${rate(unanswerable.map((r) => r.correctRefusal === true))}`);
  console.log(
    `Distance distribution (top hit per question): min=${distances[0]?.toFixed(3)} p50=${distances[Math.floor(distances.length / 2)]?.toFixed(3)} max=${distances[distances.length - 1]?.toFixed(3)} — current maxCosineDistance=${DEFAULTS.rag.maxCosineDistance}`,
  );

  const falseRefusals = answerable.filter((r) => r.insufficientKnowledge);
  if (falseRefusals.length > 0) {
    console.log(`\n${falseRefusals.length} answerable question(s) were incorrectly refused (insufficientKnowledge):`);
    for (const r of falseRefusals) console.log(`  - "${r.question.question}"`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
