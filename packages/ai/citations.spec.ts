import { describe, expect, it } from "vitest";
import { parseTrailer, validateCitations, type RetrievedChunkRef } from "./citations";

describe("parseTrailer (Section 5 'Output format')", () => {
  it("splits the answer text from the trailing JSON trailer", () => {
    const result = parseTrailer('The answer is 42 [1].\n{"citations":[1],"insufficientKnowledge":false}');
    expect(result.answerText).toBe("The answer is 42 [1].");
    expect(result.citations).toEqual([1]);
    expect(result.insufficientKnowledge).toBe(false);
  });

  it("handles a multi-line answer before the trailer", () => {
    const text = "Line one.\nLine two [2].\n{\"citations\":[2],\"insufficientKnowledge\":false}";
    const result = parseTrailer(text);
    expect(result.answerText).toBe("Line one.\nLine two [2].");
    expect(result.citations).toEqual([2]);
  });

  it("falls back to the whole text with no citations when there is no valid trailer", () => {
    const result = parseTrailer("Just an answer with no trailer at all.");
    expect(result.answerText).toBe("Just an answer with no trailer at all.");
    expect(result.citations).toEqual([]);
    expect(result.insufficientKnowledge).toBe(false);
  });

  it("reports insufficientKnowledge from the trailer", () => {
    const result = parseTrailer('I could not find this in the docs.\n{"citations":[],"insufficientKnowledge":true}');
    expect(result.insufficientKnowledge).toBe(true);
  });
});

describe("validateCitations (Section 5 'Citations')", () => {
  const retrieved: RetrievedChunkRef[] = [
    { index: 1, chunkId: "chunk-a", documentId: "doc-a", documentName: "A.pdf", pageNumber: 1 },
    { index: 2, chunkId: "chunk-b", documentId: "doc-b", documentName: "B.pdf", pageNumber: 3 },
  ];

  it("maps cited numbers to their chunks", () => {
    expect(validateCitations([1, 2], retrieved)).toEqual([
      { index: 1, chunkId: "chunk-a", documentId: "doc-a", documentName: "A.pdf", pageNumber: 1 },
      { index: 2, chunkId: "chunk-b", documentId: "doc-b", documentName: "B.pdf", pageNumber: 3 },
    ]);
  });

  it("drops citation numbers that were never supplied to the model", () => {
    expect(validateCitations([1, 99], retrieved)).toEqual([
      { index: 1, chunkId: "chunk-a", documentId: "doc-a", documentName: "A.pdf", pageNumber: 1 },
    ]);
  });

  it("de-dupes repeated citations of the same chunk", () => {
    expect(validateCitations([1, 1, 1], retrieved)).toHaveLength(1);
  });

  it("returns an empty list when nothing was cited", () => {
    expect(validateCitations([], retrieved)).toEqual([]);
  });
});
