import { describe, expect, it } from "vitest";
import { detectLanguage, detectLanguageSwitch, normalizeText } from "./language";

describe("normalizeText", () => {
  it("strips Vietnamese diacritics and đ so accented and unaccented input match", () => {
    expect(normalizeText("  Cảm ƠN  bạn   ĐÃ giúp ")).toBe("cam on ban da giup");
  });
});

describe("detectLanguage (Section 5 'Language')", () => {
  it.each([
    ["công ty tên gì", "vi"],
    ["xin chào", "vi"],
    ["cam on ban nhe", "vi"],
    ["what is your company name?", "en"],
    ["hi", "en"],
    ["refund window?", null],
    ["ok", null],
    ["NovaSoft", null],
    ["?", null],
  ] as const)("%s → %s", (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });
});

describe("detectLanguageSwitch — explicit requests only", () => {
  it.each([
    ["trả lời bằng tiếng anh", "en"],
    ["tra loi bang tieng anh di", "en"],
    ["nói tiếng Anh nhé", "en"],
    ["Please reply in English", "en"],
    ["can you speak English?", "en"],
    ["English please", "en"],
    ["english", "en"],
    ["trả lời bằng tiếng việt", "vi"],
    ["chuyển sang tiếng Việt", "vi"],
    ["reply in Vietnamese", "vi"],
    ["Tiếng Việt", "vi"],
  ] as const)("%s → %s", (text, expected) => {
    expect(detectLanguageSwitch(text)?.language).toBe(expected);
  });

  it.each(["Is the manual available in English?", "tài liệu có bản tiếng anh không?", "Vietnamese customers get free shipping?", "hello"])(
    "does not switch on a mere mention: %s",
    (text) => {
      expect(detectLanguageSwitch(text)).toBeNull();
    },
  );

  it("returns the rest of the message so callers can tell a bare switch from switch + question", () => {
    expect(detectLanguageSwitch("answer in English: what is the refund window?")?.remainder).toContain("refund window");
  });
});
