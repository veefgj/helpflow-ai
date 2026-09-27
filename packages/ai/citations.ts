// Section 5 "Output format" + "Citations": the model streams answer text followed by a JSON
// trailer on its own line, {citations: number[], insufficientKnowledge: boolean}, parsed once the
// stream ends. The server then maps cited numbers to the chunks actually supplied to the model —
// unknown numbers are dropped, never trusted at face value.

export interface RetrievedChunkRef {
  /** [1]..[K] as rendered in the prompt — matches what the model is allowed to cite. */
  index: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
}

export interface ValidatedCitation {
  index: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
}

export interface ParsedTrailer {
  answerText: string;
  citations: number[];
  insufficientKnowledge: boolean;
}

function isTrailerShape(value: unknown): value is { citations: unknown[]; insufficientKnowledge: boolean } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.citations) && typeof v.insufficientKnowledge === "boolean";
}

/** Parses the trailing JSON line off a full streamed response. Falls back to no citations /
 * insufficientKnowledge=false if the model never produced a well-formed trailer. */
export function parseTrailer(fullText: string): ParsedTrailer {
  const lines = fullText.split("\n");
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
    const candidate = lines[i]!.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isTrailerShape(parsed)) {
        return {
          answerText: lines.slice(0, i).join("\n").trim(),
          citations: parsed.citations.filter((n): n is number => typeof n === "number"),
          insufficientKnowledge: parsed.insufficientKnowledge,
        };
      }
    } catch {
      // not JSON — keep scanning earlier lines in case of trailing blank lines
    }
  }
  return { answerText: fullText.trim(), citations: [], insufficientKnowledge: false };
}

/** Drops any cited number that doesn't match a chunk actually supplied to the model, and de-dupes. */
export function validateCitations(citedIndexes: number[], retrieved: RetrievedChunkRef[]): ValidatedCitation[] {
  const byIndex = new Map(retrieved.map((r) => [r.index, r]));
  const seen = new Set<number>();
  const result: ValidatedCitation[] = [];
  for (const idx of citedIndexes) {
    if (seen.has(idx)) continue;
    const chunk = byIndex.get(idx);
    if (!chunk) continue;
    seen.add(idx);
    result.push({ index: chunk.index, chunkId: chunk.chunkId, documentId: chunk.documentId, documentName: chunk.documentName, pageNumber: chunk.pageNumber });
  }
  return result;
}
