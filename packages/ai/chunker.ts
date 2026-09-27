// Section 5 "Chunk": 800 tokens, 120 overlap; keeps pageNumber and chunkIndex for citations.
// Chunking runs per page so a chunk never straddles a page boundary — citations stay accurate.
import { decodeTokens, encodeTokens } from "./tokenizer";

export interface PageText {
  pageNumber: number | null;
  text: string;
}

export interface Chunk {
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  chunkTokens: number;
  overlapTokens: number;
}

function chunkPageText(text: string, opts: ChunkOptions): string[] {
  const tokens = encodeTokens(text);
  if (tokens.length === 0) return [];

  const step = opts.chunkTokens - opts.overlapTokens;
  const pieces: string[] = [];
  let start = 0;
  while (start < tokens.length) {
    const end = Math.min(start + opts.chunkTokens, tokens.length);
    pieces.push(decodeTokens(tokens.slice(start, end)));
    if (end === tokens.length) break;
    start += step;
  }
  return pieces;
}

export function chunkPages(pages: PageText[], opts: ChunkOptions): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  for (const page of pages) {
    const trimmed = page.text.trim();
    if (!trimmed) continue;
    for (const content of chunkPageText(trimmed, opts)) {
      chunks.push({ chunkIndex: chunkIndex++, pageNumber: page.pageNumber, content, tokenCount: encodeTokens(content).length });
    }
  }
  return chunks;
}
