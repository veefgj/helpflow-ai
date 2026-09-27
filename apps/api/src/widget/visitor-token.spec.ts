import { afterEach, describe, expect, it, vi } from "vitest";
import { issueVisitorToken, verifyVisitorToken } from "./visitor-token";

const basePayload = { organizationId: "org-1", chatbotId: "bot-1", customerId: "cust-1", visitorId: "visitor-1" };

describe("visitor token (Section 6 'Token content')", () => {
  it("round-trips a signed token", () => {
    const token = issueVisitorToken(basePayload);
    const verified = verifyVisitorToken(token);
    expect(verified).toMatchObject(basePayload);
  });

  it("rejects a token minted for a different chatbot", () => {
    const token = issueVisitorToken(basePayload);
    expect(verifyVisitorToken(token, "some-other-bot")).toBeNull();
  });

  it("accepts a token when the expected chatbotId matches", () => {
    const token = issueVisitorToken(basePayload);
    expect(verifyVisitorToken(token, "bot-1")).not.toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = issueVisitorToken(basePayload);
    const [, sig] = token.split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ ...basePayload, customerId: "someone-elses-customer", exp: Date.now() + 1000 })).toString(
      "base64url",
    );
    expect(verifyVisitorToken(`${tamperedBody}.${sig}`)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyVisitorToken("not-a-real-token")).toBeNull();
    expect(verifyVisitorToken("")).toBeNull();
  });

  it("rejects a token once its sliding TTL has elapsed", () => {
    const token = issueVisitorToken(basePayload);
    expect(verifyVisitorToken(token)).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000); // 31 days later — past the 30-day TTL
    expect(verifyVisitorToken(token)).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
