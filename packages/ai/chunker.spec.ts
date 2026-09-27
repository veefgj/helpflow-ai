import { describe, expect, it } from "vitest";
import { chunkPages } from "./chunker";
import { encodeTokens } from "./tokenizer";

describe("chunkPages (Section 5)", () => {
  it("returns one chunk when a page fits within chunkTokens", () => {
    const chunks = chunkPages([{ pageNumber: 1, text: "The quick brown fox jumps over the lazy dog." }], {
      chunkTokens: 800,
      overlapTokens: 120,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, pageNumber: 1 });
  });

  it("splits a long page into overlapping chunks that never straddle a page boundary", () => {
    const longText = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkPages([{ pageNumber: 3, text: longText }], { chunkTokens: 800, overlapTokens: 120 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.pageNumber === 3)).toBe(true);
    // chunkIndex is sequential starting at 0
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    // consecutive chunks overlap: the tail of one reappears at the head of the next
    const firstTokens = encodeTokens(chunks[0]!.content);
    const secondTokens = encodeTokens(chunks[1]!.content);
    expect(firstTokens.slice(-120)).toEqual(secondTokens.slice(0, 120));
  });

  it("assigns increasing chunkIndex across multiple pages and skips blank pages", () => {
    const chunks = chunkPages(
      [
        { pageNumber: 1, text: "first page content" },
        { pageNumber: 2, text: "   " },
        { pageNumber: 3, text: "third page content" },
      ],
      { chunkTokens: 800, overlapTokens: 120 },
    );
    expect(chunks.map((c) => c.pageNumber)).toEqual([1, 3]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("handles a document with no extractable text by returning no chunks", () => {
    expect(chunkPages([{ pageNumber: 1, text: "" }], { chunkTokens: 800, overlapTokens: 120 })).toEqual([]);
  });
});
