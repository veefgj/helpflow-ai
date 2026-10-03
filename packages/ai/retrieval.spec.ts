import { describe, expect, it } from "vitest";
import { selectContext, type RetrievedRow } from "./retrieval";

describe("selectContext (Section 5 'Runtime retrieval')", () => {
  const names = new Map([
    ["doc-a", "A.txt"],
    ["doc-b", "B.txt"],
  ]);

  it("returns insufficientKnowledge when every row is past the distance threshold", () => {
    // 0.9 > DEFAULTS.rag.maxCosineDistance (0.7) so it must be dropped:
    const rows: RetrievedRow[] = [{ id: "c1", documentId: "doc-a", pageNumber: null, content: "x", distance: 0.9 }];
    const result = selectContext(rows, names);
    expect(result.insufficientKnowledge).toBe(true);
    expect(result.context).toEqual([]);
  });

  it("returns insufficientKnowledge when there are no rows at all", () => {
    expect(selectContext([], names)).toEqual({ insufficientKnowledge: true, context: [] });
  });

  it("numbers surviving rows [1]..[K] in ascending distance order (closer first)", () => {
    const rows: RetrievedRow[] = [
      { id: "c1", documentId: "doc-a", pageNumber: 2, content: "far", distance: 0.5 },
      { id: "c2", documentId: "doc-b", pageNumber: 1, content: "close", distance: 0.1 },
    ];
    const result = selectContext(rows, names);
    expect(result.insufficientKnowledge).toBe(false);
    expect(result.context.map((c) => c.chunkId)).toEqual(["c2", "c1"]);
    expect(result.context.map((c) => c.index)).toEqual([1, 2]);
    expect(result.context[0]).toMatchObject({ documentName: "B.txt", pageNumber: 1 });
  });

  it("drops only the rows past threshold, keeping the ones within it", () => {
    const rows: RetrievedRow[] = [
      { id: "c1", documentId: "doc-a", pageNumber: null, content: "in", distance: 0.4 },
      { id: "c2", documentId: "doc-a", pageNumber: null, content: "out", distance: 0.8 },
    ];
    const result = selectContext(rows, names);
    expect(result.context).toHaveLength(1);
    expect(result.context[0]!.chunkId).toBe("c1");
  });
});
