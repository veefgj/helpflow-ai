import { describe, expect, it } from "vitest";
import { buildChatMessages } from "./prompt-builder";
import type { NumberedContext } from "./retrieval";

const context: NumberedContext[] = [
  { index: 1, chunkId: "c1", documentId: "d1", documentName: "about.txt", pageNumber: null, content: "NovaSoft was founded in 2015.", distance: 0.3 },
];

describe("buildChatMessages", () => {
  it("grounded mode: strict rules, session language, handoff wording and the knowledge block", () => {
    const [system] = buildChatMessages({ tenantSystemPrompt: "Be concise.", context, history: [], customerMessage: "công ty thành lập năm nào?", language: "vi" });
    expect(system!.content).toContain("ONLY the information inside the <knowledge> block");
    expect(system!.content).toContain("never infer");
    expect(system!.content).toContain("Always reply in Vietnamese");
    expect(system!.content).toContain("Never say or imply that you have\nconnected them");
    expect(system!.content).toContain("[1] NovaSoft was founded in 2015.");
    // tenant prompt sits below the platform rules
    expect(system!.content.indexOf("Be concise.")).toBeGreaterThan(system!.content.indexOf("Grounding rules"));
  });

  it("social mode: no knowledge block, forbids business facts, forces an empty-citation trailer", () => {
    const messages = buildChatMessages({ tenantSystemPrompt: null, context, history: [], customerMessage: "xin chào", language: "en", socialIntent: "greeting" });
    const system = messages[0]!.content;
    expect(system).not.toContain("<knowledge>");
    expect(system).not.toContain("NovaSoft was founded");
    expect(system).toContain("small talk (greeting)");
    expect(system).toContain("do not state any facts about the company");
    expect(system).toContain("Always reply in English");
    expect(system).toContain('{"citations": [], "insufficientKnowledge": false}');
    expect(messages.at(-1)).toEqual({ role: "user", content: "xin chào" });
  });
});
