// Deterministic stand-ins for OpenAI (Section 10 "E2E: Playwright ... with a stubbed LLM provider
// (deterministic stream)"). Used whenever AI_PROVIDER=fake — no network call, no API key needed —
// so the rest of the RAG/citation/streaming pipeline can be built and tested without OpenAI access.
import { createHash } from "node:crypto";
import { countTokens } from "./tokenizer";
import type { ChatCompletionResult, ChatStreamParams, EmbeddingOutput, EmbeddingProvider, LlmProvider } from "./provider";

const EMBEDDING_DIM = 1536;

/** Deterministic hash of one token into a dimension index + sign (the "hashing trick"). */
function hashToken(token: string, dim: number): { index: number; sign: 1 | -1 } {
  const hash = createHash("sha1").update(token).digest();
  const index = hash.readUInt32BE(0) % dim;
  const sign = hash[4]! % 2 === 0 ? 1 : -1;
  return { index, sign };
}

/**
 * Bag-of-words feature-hashed "embedding": texts sharing vocabulary land closer together in cosine
 * distance, texts with no shared words land near-orthogonal — enough for the retrieval pipeline
 * (chunking, distance threshold, citations) to be exercised meaningfully without a real API key.
 * Not a real semantic embedding.
 */
// A tiny stopword list so common function words don't dilute the (already crude) similarity signal.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on", "for",
  "and", "or", "do", "does", "did", "have", "has", "had", "i", "you", "it", "this", "that", "how",
  "many", "much", "can", "could", "will", "would", "should", "with", "at", "by", "from", "as", "if",
]);

function bagOfWordsVector(text: string, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t));
  for (const token of tokens) {
    const { index, sign } = hashToken(token, dim);
    vec[index] = (vec[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = "fake-embedding";

  async embed(texts: string[]): Promise<EmbeddingOutput[]> {
    return texts.map((text) => ({ embedding: bagOfWordsVector(text, EMBEDDING_DIM), tokens: countTokens(text) }));
  }
}

/** Finds "[<n>] " context markers our prompt builder emits for retrieved chunks, in order. */
function findContextIndexes(messages: ChatStreamParams["messages"]): number[] {
  const text = messages.map((m) => m.content).join("\n");
  const matches = [...text.matchAll(/^\[(\d+)\]\s/gm)];
  return matches.map((m) => Number(m[1]));
}

export class FakeLlmProvider implements LlmProvider {
  readonly model = "fake-chat";

  async streamChatCompletion(params: ChatStreamParams): Promise<ChatCompletionResult> {
    const contextIndexes = findContextIndexes(params.messages);
    const citation = contextIndexes[0];
    const answerText = citation
      ? `This is a deterministic test answer grounded in the provided knowledge [${citation}].`
      : "This is a deterministic test answer.";
    const trailer = JSON.stringify({ citations: citation ? [citation] : [], insufficientKnowledge: false });
    const fullText = `${answerText}\n${trailer}`;

    const words = fullText.split(/(?<=\s)/);
    for (const word of words) {
      if (params.signal?.aborted) {
        return { content: answerText, inputTokens: countTokens(answerText), outputTokens: 0, interrupted: true };
      }
      params.onChunk(word);
    }

    const inputTokens = params.messages.reduce((sum, m) => sum + countTokens(m.content), 0);
    return { content: fullText, inputTokens, outputTokens: countTokens(fullText), interrupted: false };
  }
}
