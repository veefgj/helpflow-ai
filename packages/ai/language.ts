// Section 5 "Language": deterministic session-language detection and explicit switch requests.
// Deterministic on purpose — the session language is persisted on the conversation BEFORE the model
// runs, so it must not depend on the model's own output.
import type { Language } from "@helpflow/types";

/** Lower-cases, strips Vietnamese diacritics (đ → d) and collapses whitespace, so accented and
 * unaccented ("cảm ơn" / "cam on") input match the same patterns. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

const VI_DIACRITICS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
// Unaccented Vietnamese words that are not also common English words.
const VI_WORDS = new Set(["chao", "cam", "khong", "duoc", "toi", "ban", "minh", "nhe", "nha", "vay", "gi", "nhieu", "nao", "lam", "giup", "voi", "cua", "dau", "sao", "oi", "nhan", "vien", "cong", "ty"]);
const EN_WORDS = new Set([
  "the", "is", "are", "what", "how", "when", "where", "why", "who", "which", "can", "could", "do", "does", "my", "your",
  "you", "i", "hello", "hi", "hey", "thanks", "thank", "please", "need", "want", "about", "with", "for", "of",
]);

/** Language of a free-text message, or null when it carries no clear signal (e.g. "ok", "?", "NovaSoft"). */
export function detectLanguage(text: string): Language | null {
  if (VI_DIACRITICS.test(text)) return "vi";
  const words = normalizeText(text).split(/[^a-z]+/).filter(Boolean);
  let vi = 0;
  let en = 0;
  for (const word of words) {
    if (VI_WORDS.has(word)) vi++;
    if (EN_WORDS.has(word)) en++;
  }
  if (vi > en) return "vi";
  if (en > vi) return "en";
  return null;
}

// Only an explicit request switches the session language: a request verb aimed at the language, or
// the language name on its own. "Is the manual available in English?" must NOT switch.
const SWITCH_PATTERNS: Array<{ language: Language; pattern: RegExp }> = [
  {
    language: "en",
    pattern:
      /(\b(speak|reply|answer|respond|talk|write|chat|continue|switch|change|use)( to| in| with)? (in )?english\b)|(\benglish,? please\b)|(\b(tra loi|noi chuyen|noi|dung|chuyen sang|doi sang|chuyen|doi|viet|chat)( lai)? (bang )?tieng anh\b)|(^(in )?(english|tieng anh)( please| di| nhe| nha| duoc khong)?$)/,
  },
  {
    language: "vi",
    pattern:
      /(\b(speak|reply|answer|respond|talk|write|chat|continue|switch|change|use)( to| in| with)? (in )?vietnamese\b)|(\bvietnamese,? please\b)|(\b(tra loi|noi chuyen|noi|dung|chuyen sang|doi sang|chuyen|doi|viet|chat)( lai)? (bang )?tieng viet\b)|(^(in )?(vietnamese|tieng viet)( please| di| nhe| nha| duoc khong)?$)/,
  },
];

export interface LanguageSwitch {
  language: Language;
  /** The message with the switch request removed — used to decide whether anything else was asked. */
  remainder: string;
}

/** An explicit request to change the session language, or null. */
export function detectLanguageSwitch(text: string): LanguageSwitch | null {
  const normalized = normalizeText(text);
  for (const { language, pattern } of SWITCH_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match) {
      return { language, remainder: (normalized.slice(0, match.index) + " " + normalized.slice(match.index + match[0].length)).trim() };
    }
  }
  return null;
}

export function languageName(language: Language): string {
  return language === "vi" ? "Vietnamese (tiếng Việt)" : "English";
}
