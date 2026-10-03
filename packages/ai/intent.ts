// Section 5 "Conversational intents": decides — in code, never by the model — whether a customer
// message may skip retrieval. A message is social ONLY when the whole of it is small talk; anything
// else (including "hi, what's your refund window?") goes through RAG, so small talk can never become a
// path for ungrounded business answers.
import { detectLanguageSwitch, normalizeText } from "./language";

export type SocialIntent = "greeting" | "thanks" | "goodbye" | "language_switch" | "clarification";

// Phrases are matched on normalizeText() output (lower-case, no diacritics), longest first.
const SOCIAL_PHRASES: Record<Exclude<SocialIntent, "language_switch">, string[]> = {
  greeting: [
    "xin chao", "chao buoi sang", "chao buoi chieu", "chao buoi toi", "chao", "alo", "hello", "hi", "hey", "hiya", "good morning",
    "good afternoon", "good evening", "greetings", "yo",
  ],
  thanks: ["cam on nhieu", "cam on", "cam ta", "thank you so much", "thank you very much", "thank you", "thanks a lot", "thanks", "thx", "ty", "many thanks", "appreciate it"],
  goodbye: ["tam biet", "hen gap lai", "bye bye", "bye", "goodbye", "good bye", "see you", "see ya", "have a nice day", "chuc mot ngay tot lanh"],
  clarification: [
    "y ban la gi", "y ban la sao", "y la sao", "la sao", "nghia la gi", "the la sao", "khong hieu", "chua hieu", "toi khong hieu", "minh khong hieu",
    "noi ro hon", "giai thich lai", "gi", "ha", "sao", "what do you mean", "i don't understand", "i dont understand", "can you explain",
    "say again", "pardon", "sorry", "what", "huh", "help", "help me", "giup toi", "giup minh", "giup voi", "ho tro", "tu van", "can giup",
  ],
};

// Words that carry no request on their own: politeness particles, address terms, interjections.
const FILLERS = new Set([
  "a", "ah", "oh", "ok", "oke", "okay", "nhe", "nha", "nhi", "oi", "u", "um", "uhm", "da", "vang", "ban", "bot", "minh", "em", "anh", "chi",
  "shop", "ad", "admin", "nhieu", "lam", "you", "there", "so", "much", "very", "lot", "again", "all", "everyone", "team", "please", "nua",
  "roi", "voi", "ne", "to", "toi", "di", "duoc", "khong", "from", "now", "on",
]);

const TOKEN_LIST = Object.entries(SOCIAL_PHRASES)
  .flatMap(([intent, phrases]) => phrases.map((phrase) => ({ intent: intent as SocialIntent, words: phrase.split(" ") })))
  .sort((a, b) => b.words.length - a.words.length);

function wordsOf(normalized: string): string[] {
  return normalized.replace(/[^a-z0-9' ]+/g, " ").split(" ").filter(Boolean);
}

/** Consumes the words with social phrases + fillers. Returns the first social intent seen (fillers
 * alone, e.g. "ok", count as clarification), or null if any word is left over (= it asks for something). */
function matchWhollySocial(words: string[]): SocialIntent | null {
  let first: SocialIntent | null = null;
  let i = 0;
  outer: while (i < words.length) {
    for (const { intent, words: phrase } of TOKEN_LIST) {
      if (phrase.every((w, k) => words[i + k] === w)) {
        first ??= intent;
        i += phrase.length;
        continue outer;
      }
    }
    if (FILLERS.has(words[i]!)) {
      i++;
      continue;
    }
    return null;
  }
  return first ?? "clarification";
}

/** The social intent of a message that is small talk and nothing else; null for anything that needs RAG. */
export function classifySocialIntent(text: string): SocialIntent | null {
  const languageSwitch = detectLanguageSwitch(text);
  if (languageSwitch) {
    const rest = wordsOf(languageSwitch.remainder);
    return rest.length === 0 || matchWhollySocial(rest) !== null ? "language_switch" : null;
  }
  const words = wordsOf(normalizeText(text));
  if (words.length === 0) return text.trim().length > 0 ? "clarification" : null; // "?", "??", emoji only
  return matchWhollySocial(words);
}

// Explicit request for a human — honored at any point while the AI is active.
const HANDOFF_REQUEST =
  /(\b(talk|speak|chat|connect)( me)?( to| with)? (a |an |the |some )?(real )?(human|person|agent|staff|someone|support agent|representative|operator)\b)|(\b(gap|noi chuyen voi|ket noi( voi)?|chuyen( cho)?( toi| minh)?( sang| qua)?|can|muon gap|cho (toi|minh|em) gap) (mot )?(nhan vien|nguoi that|tu van vien|nguoi ho tro|admin|ad|nguoi)\b)|(^(human|agent|real person|nhan vien|nguoi that|tu van vien)( please| di| nhe| nha)?$)/;

// Bare consent — only meaningful right after the AI offered a handoff.
const CONSENT = new Set([
  "co", "co a", "co nhe", "co chu", "ok", "oke", "okay", "ok nhe", "u", "um", "uhm", "vang", "da", "da vang", "dong y", "duoc", "dc", "duoc a",
  "yes", "yes please", "yeah", "yep", "sure", "please", "ok please", "of course", "ket noi di", "ket noi giup toi", "ket noi giup minh", "co ket noi",
]);

/**
 * True when the customer's message asks for a human: an explicit request at any time, or a bare
 * "yes / có / ok" when the previous AI message offered one (insufficientKnowledge = true).
 */
export function detectHandoffIntent(text: string, lastAiOfferedHandoff: boolean): boolean {
  const normalized = normalizeText(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (HANDOFF_REQUEST.test(normalized)) return true;
  return lastAiOfferedHandoff && CONSENT.has(normalized);
}
