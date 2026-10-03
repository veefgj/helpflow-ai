import { describe, expect, it } from "vitest";
import { classifySocialIntent, detectHandoffIntent } from "./intent";

describe("classifySocialIntent (Section 5 'Conversational intents')", () => {
  it.each([
    ["xin chào", "greeting"],
    ["Chào bạn!", "greeting"],
    ["hi", "greeting"],
    ["Hello there 👋", "greeting"],
    ["cảm ơn nhé", "thanks"],
    ["thanks a lot!", "thanks"],
    ["tạm biệt", "goodbye"],
    ["bye", "goodbye"],
    ["trả lời bằng tiếng anh", "language_switch"],
    ["please reply in Vietnamese", "language_switch"],
    ["gì?", "clarification"],
    ["ý bạn là sao", "clarification"],
    ["what?", "clarification"],
    ["ok", "clarification"],
    ["?", "clarification"],
  ] as const)("%s → %s", (text, expected) => {
    expect(classifySocialIntent(text)).toBe(expected);
  });

  // Small talk must never become a path around retrieval: anything beyond it goes through RAG.
  it.each([
    "công ty tên gì",
    "xin chào, công ty tên gì?",
    "hi, do you sell gift cards?",
    "thanks, and what about express shipping?",
    "what is your company name?",
    "answer in English: what is the refund window?",
    "chào, giá bao nhiêu?",
    "refund window?",
  ])("routes to RAG: %s", (text) => {
    expect(classifySocialIntent(text)).toBeNull();
  });
});

describe("detectHandoffIntent", () => {
  it.each(["i want to talk to a human", "talk to a human", "connect me with an agent", "cho tôi gặp nhân viên", "gặp người thật", "nhân viên"])(
    "explicit request counts any time: %s",
    (text) => {
      expect(detectHandoffIntent(text, false)).toBe(true);
    },
  );

  it.each(["có", "Có ạ", "ok", "đồng ý", "yes please", "vâng"])("bare consent counts only after a handoff offer: %s", (text) => {
    expect(detectHandoffIntent(text, true)).toBe(true);
    expect(detectHandoffIntent(text, false)).toBe(false);
  });

  it.each(["có bán thẻ quà tặng không?", "yes, and what about shipping?", "human resources policy?"])("is not a handoff: %s", (text) => {
    expect(detectHandoffIntent(text, true)).toBe(false);
  });
});
