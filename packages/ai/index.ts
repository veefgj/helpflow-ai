import { loadEnv } from "@helpflow/config";
import { OpenAiEmbeddingProvider, OpenAiLlmProvider } from "./openai-provider";
import { FakeEmbeddingProvider, FakeLlmProvider } from "./fake-provider";
import type { EmbeddingProvider, LlmProvider } from "./provider";

export * from "./provider";
export * from "./tokenizer";
export * from "./chunker";
export * from "./citations";
export * from "./retrieval";
export * from "./prompt-builder";
export * from "./language";
export * from "./intent";

let embeddingProvider: EmbeddingProvider | null = null;
let llmProvider: LlmProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) return embeddingProvider;
  embeddingProvider = loadEnv().AI_PROVIDER === "fake" ? new FakeEmbeddingProvider() : new OpenAiEmbeddingProvider();
  return embeddingProvider;
}

export function getLlmProvider(): LlmProvider {
  if (llmProvider) return llmProvider;
  llmProvider = loadEnv().AI_PROVIDER === "fake" ? new FakeLlmProvider() : new OpenAiLlmProvider();
  return llmProvider;
}
