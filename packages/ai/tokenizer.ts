// Shared token counting for chunking (Section 5: 800 tokens / 120 overlap) and quota estimation
// (Section 8). cl100k_base matches OpenAI's GPT-4-family / text-embedding-3 tokenizer closely enough
// for chunk sizing and estimates; exact reconciliation always uses the provider-reported usage.
import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("cl100k_base");

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

/** Splits `tokens` back into text after slicing — used by the chunker to cut on token boundaries. */
export function decodeTokens(tokens: number[]): string {
  return encoding.decode(tokens);
}

export function encodeTokens(text: string): number[] {
  return encoding.encode(text);
}
