// ADR-005 / Section 6 "Token content": HMAC-signed {organizationId, chatbotId, customerId,
// visitorId, exp}, sliding 30-day TTL. A token minted for chatbot A is rejected on chatbot B.
// Deliberately not a JWT — the widget's own signed token, distinct from the staff access JWT.
import { createHmac, timingSafeEqual } from "node:crypto";
import { DEFAULTS, loadEnv } from "@helpflow/config";

export interface VisitorTokenPayload {
  organizationId: string;
  chatbotId: string;
  customerId: string;
  visitorId: string;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", loadEnv().VISITOR_TOKEN_SECRET).update(body).digest("base64url");
}

export function issueVisitorToken(payload: Omit<VisitorTokenPayload, "exp">): string {
  const full: VisitorTokenPayload = { ...payload, exp: Date.now() + DEFAULTS.visitor.tokenTtlDays * 24 * 60 * 60 * 1000 };
  const body = base64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

/** Returns null for any malformed, mis-signed, expired, or (when chatbotId is given) mismatched token. */
export function verifyVisitorToken(token: string, expectedChatbotId?: string): VisitorTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expectedSignature = sign(body);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: VisitorTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  if (expectedChatbotId && payload.chatbotId !== expectedChatbotId) return null;
  return payload;
}
