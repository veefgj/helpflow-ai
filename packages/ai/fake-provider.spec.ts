import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider, FakeLlmProvider } from "./fake-provider";

function cosineSimilarity(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * b[i]!, 0);
}

describe("FakeEmbeddingProvider (deterministic, no network)", () => {
  const provider = new FakeEmbeddingProvider();

  it("is deterministic for the same text", async () => {
    const [a] = await provider.embed(["refund policy for enterprise customers"]);
    const [b] = await provider.embed(["refund policy for enterprise customers"]);
    expect(a!.embedding).toEqual(b!.embedding);
  });

  it("gives higher cosine similarity to texts that share vocabulary than to unrelated text", async () => {
    const [question, matchingChunk, unrelatedChunk] = await provider.embed([
      "how many days do I have to request a refund",
      "customers may request a full refund within 30 days of purchase",
      "our office is located in the historic downtown district near the river",
    ]);
    const simToMatch = cosineSimilarity(question!.embedding, matchingChunk!.embedding);
    const simToUnrelated = cosineSimilarity(question!.embedding, unrelatedChunk!.embedding);
    expect(simToMatch).toBeGreaterThan(simToUnrelated);
  });

  it("returns a unit-length 1536-dim vector", async () => {
    const [result] = await provider.embed(["some text"]);
    expect(result!.embedding).toHaveLength(1536);
    const norm = Math.sqrt(result!.embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("FakeLlmProvider", () => {
  it("cites the first numbered context block found in the prompt", async () => {
    const provider = new FakeLlmProvider();
    let streamed = "";
    const result = await provider.streamChatCompletion({
      messages: [
        { role: "system", content: "[1] Refunds are available within 30 days.\n\n[2] Other info." },
        { role: "user", content: "How long is the refund window?" },
      ],
      maxTokens: 100,
      temperature: 0,
      onChunk: (delta) => {
        streamed += delta;
      },
    });
    expect(streamed).toContain("[1]");
    expect(result.content).toContain('"citations":[1]');
  });
});
