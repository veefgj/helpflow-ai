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
  classifySocialIntent,
  detectLanguage,
  detectLanguageSwitch,
  getEmbeddingProvider,
  getLlmProvider,
  parseTrailer,
  selectContext,
  validateCitations,
  type NumberedContext,
  type RetrievedRow,
} from "@helpflow/ai";
import type { Language } from "@helpflow/types";
import { seedEvalCorpus, type EvalFixtures } from "./seed-eval-corpus";

interface GoldQuestion {
  question: string;
  expectedDocumentKey: keyof EvalFixtures["documents"] | null;
  expectedPage: number | null;
  expectedFacts: string[];
  answerable: boolean;
  /** Pure small talk — must route to the social path (no retrieval, no citations). */
  social?: boolean;
  /** Expected reply language (session language); defaults to what the production gateway would pick. */
  language?: Language;
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
  routedSocial: boolean;
  grounded: boolean | null; // every claim supported by the supplied knowledge (LLM-judged); null = refused/social
  languageCorrect: boolean | null;
  citedSomething: boolean;
}

function loadGoldSet(): GoldQuestion[] {
  const raw = readFileSync(join(__dirname, "rag-gold.jsonl"), "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GoldQuestion);
}

async function judgeYesNo(system: string, user: string): Promise<boolean> {
  let text = "";
  const result = await getLlmProvider().streamChatCompletion({
    messages: [
      { role: "system", content: `${system} Reply with exactly one word, YES or NO. Do not explain.` },
      { role: "user", content: user },
    ],
    maxTokens: 5,
    temperature: 0,
    onChunk: (delta) => {
      text += delta;
    },
  });
  return /yes/i.test(result.content || text);
}

/** Answer correctness: does the answer state the expected fact? */
function judgeFact(answer: string, fact: string): Promise<boolean> {
  return judgeYesNo("You are grading a customer support answer: does the ANSWER clearly state the FACT?", `FACT: ${fact}\n\nANSWER: ${answer}`);
}

/** Groundedness: is every business claim in the answer supported by the knowledge the model was given? */
function judgeGrounded(answer: string, context: NumberedContext[]): Promise<boolean> {
  return judgeYesNo(
    "You are auditing a customer support answer for hallucination. Is EVERY factual claim in the ANSWER (about the company, products, prices, policies, times) explicitly supported by the KNOWLEDGE? Offers to connect a human agent and statements that information is unavailable count as supported.",
    `KNOWLEDGE:\n${context.map((c) => `[${c.index}] ${c.content}`).join("\n\n")}\n\nANSWER: ${answer}`,
  );
}

/** Vietnamese is detected reliably (diacritics); an English reply just must not be Vietnamese — short
 * English answers often contain none of detectLanguage()'s English marker words. */
function repliedIn(answer: string, language: Language): boolean {
  const detected = detectLanguage(answer);
  return language === "vi" ? detected === "vi" : detected !== "vi";
}

async function generate(messages: ReturnType<typeof buildChatMessages>): Promise<string> {
  let fullText = "";
  await getLlmProvider().streamChatCompletion({
    messages,
    maxTokens: 400,
    temperature: 0,
    onChunk: (delta) => {
      fullText += delta;
    },
  });
  return fullText;
}

async function evaluateQuestion(fixtures: EvalFixtures, q: GoldQuestion): Promise<QuestionResult> {
  // Same routing as the production gateway + AiReplyService (Section 5 "Language" / "Conversational intents").
  const language: Language = q.language ?? detectLanguageSwitch(q.question)?.language ?? detectLanguage(q.question) ?? "vi";
  const socialIntent = classifySocialIntent(q.question);
  const base = {
    question: q,
    totalFacts: q.expectedFacts.length,
    routedSocial: socialIntent !== null,
  };

  if (socialIntent) {
    const { answerText } = parseTrailer(await generate(buildChatMessages({ tenantSystemPrompt: null, context: [], history: [], customerMessage: q.question, language, socialIntent })));
    return {
      ...base,
      hit5: null,
      insufficientKnowledge: false,
      correctRefusal: null,
      citationCorrect: null,
      faithfulFacts: null,
      topDistance: null,
      grounded: null,
      languageCorrect: repliedIn(answerText, language),
      citedSomething: false, // AiReplyService discards citations on the social path
    };
  }

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
    // Server-side localized fallback, no LLM call — language is correct by construction.
    return {
      ...base,
      hit5,
      insufficientKnowledge: true,
      correctRefusal: !q.answerable,
      citationCorrect: null,
      faithfulFacts: null,
      topDistance,
      grounded: null,
      languageCorrect: true,
      citedSomething: false,
    };
  }

  const fullText = await generate(buildChatMessages({ tenantSystemPrompt: null, context, history: [], customerMessage: q.question, language }));
  const { answerText, citations, insufficientKnowledge: modelRefused } = parseTrailer(fullText);
  const validated = validateCitations(citations, context);

  const citationCorrect = q.answerable && expectedDocumentId ? validated.some((c) => c.documentId === expectedDocumentId) : null;

  let faithfulFacts: number | null = null;
  if (q.expectedFacts.length > 0) {
    const judged = await Promise.all(q.expectedFacts.map((fact) => judgeFact(answerText, fact)));
    faithfulFacts = judged.filter(Boolean).length;
  }

  return {
    ...base,
    hit5,
    insufficientKnowledge: modelRefused,
    // The model may refuse itself (trailer) even when a chunk passed the threshold.
    correctRefusal: q.answerable ? !modelRefused : modelRefused,
    citationCorrect,
    faithfulFacts,
    topDistance,
    grounded: await judgeGrounded(answerText, context),
    languageCorrect: repliedIn(answerText, language),
    citedSomething: validated.length > 0,
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

  const business = results.filter((r) => !r.question.social);
  const answerable = business.filter((r) => r.question.answerable);
  const unanswerable = business.filter((r) => !r.question.answerable);
  const social = results.filter((r) => r.question.social);
  const distances = business.map((r) => r.topDistance).filter((d): d is number => d !== null).sort((a, b) => a - b);

  console.log("\n=== HelpFlow RAG eval report ===");
  console.log(`Questions: ${results.length} (${answerable.length} answerable, ${unanswerable.length} unanswerable, ${social.length} social)`);
  console.log(`Hit@5:                 ${rate(answerable.map((r) => r.hit5 === true))}`);
  console.log(`Citation correctness:  ${rate(answerable.filter((r) => r.citationCorrect !== null).map((r) => r.citationCorrect === true))}`);
  const faithfulnessRows = business.filter((r) => r.totalFacts > 0 && r.faithfulFacts !== null);
  const totalFacts = answerable.reduce((sum, r) => sum + r.totalFacts, 0);
  const totalFaithful = faithfulnessRows.reduce((sum, r) => sum + (r.faithfulFacts ?? 0), 0);
  console.log(`Answer correctness:    ${totalFacts ? `${((totalFaithful / totalFacts) * 100).toFixed(1)}% (${totalFaithful}/${totalFacts} expected facts stated; refusals count as misses)` : "n/a"}`);
  console.log(`Groundedness:          ${rate(business.filter((r) => r.grounded !== null).map((r) => r.grounded === true))} of generated answers`);
  console.log(`Correct-refusal rate:  ${rate(unanswerable.map((r) => r.correctRefusal === true))}`);
  console.log(`False-refusal rate:    ${rate(answerable.map((r) => r.insufficientKnowledge))} (lower is better)`);
  console.log(`Social routing:        ${rate(results.map((r) => r.routedSocial === (r.question.social === true)))}`);
  console.log(`Social never cites:    ${rate(social.map((r) => !r.citedSomething))}`);
  console.log(`Session language kept: ${rate(results.filter((r) => r.languageCorrect !== null).map((r) => r.languageCorrect === true))}`);
  console.log(
    `Distance distribution (top hit per question): min=${distances[0]?.toFixed(3)} p50=${distances[Math.floor(distances.length / 2)]?.toFixed(3)} max=${distances[distances.length - 1]?.toFixed(3)} — current maxCosineDistance=${DEFAULTS.rag.maxCosineDistance}`,
  );

  const report = (label: string, rows: QuestionResult[]) => {
    if (rows.length === 0) return;
    console.log(`\n${label}:`);
    for (const r of rows) console.log(`  - "${r.question.question}"${r.topDistance !== null ? ` (top distance ${r.topDistance.toFixed(3)})` : ""}`);
  };
  report("Answerable but refused", answerable.filter((r) => r.insufficientKnowledge));
  report("Unanswerable but answered", unanswerable.filter((r) => r.correctRefusal === false));
  report("Not grounded", business.filter((r) => r.grounded === false));
  report("Wrong reply language", results.filter((r) => r.languageCorrect === false));
  report("Mis-routed (social vs RAG)", results.filter((r) => r.routedSocial !== (r.question.social === true)));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
