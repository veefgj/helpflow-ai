// HelpFlow AI — Implementation Contract v1.2: error codes shared by REST, Socket.IO acks and the worker.
// Rule: cross-tenant access returns RESOURCE_NOT_FOUND (never reveal that another tenant's resource exists).

export const ApiErrorCode = {
  // 400
  VALIDATION_ERROR: "VALIDATION_ERROR",
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
  // 401
  UNAUTHENTICATED: "UNAUTHENTICATED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  // 402 — commercial limits
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED", // monthly AI tokens or conversations
  PLAN_LIMIT_EXCEEDED: "PLAN_LIMIT_EXCEEDED", // resource count: chatbots, agents, documents
  // 403
  FORBIDDEN: "FORBIDDEN", // authenticated member, insufficient role
  RESOURCE_DISABLED: "RESOURCE_DISABLED", // chatbot/document/membership has disabledReason
  // 404
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  // 409
  CONVERSATION_ALREADY_ASSIGNED: "CONVERSATION_ALREADY_ASSIGNED",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  AI_RESPONSE_IN_PROGRESS: "AI_RESPONSE_IN_PROGRESS",
  DUPLICATE_RESOURCE: "DUPLICATE_RESOURCE",
  KNOWLEDGE_BASE_IN_USE: "KNOWLEDGE_BASE_IN_USE",
  // 410
  INVITATION_INVALID: "INVITATION_INVALID", // expired, revoked, used or email mismatch
  // 413 / 415
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  // 429
  RATE_LIMITED: "RATE_LIMITED",
  DAILY_CAP_EXCEEDED: "DAILY_CAP_EXCEEDED", // per-chatbot abuse cap
  // 5xx
  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE", // Redis, object storage
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  WEBHOOK_SIGNATURE_INVALID: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  QUOTA_EXCEEDED: 402,
  PLAN_LIMIT_EXCEEDED: 402,
  FORBIDDEN: 403,
  RESOURCE_DISABLED: 403,
  RESOURCE_NOT_FOUND: 404,
  CONVERSATION_ALREADY_ASSIGNED: 409,
  INVALID_STATE_TRANSITION: 409,
  AI_RESPONSE_IN_PROGRESS: 409,
  DUPLICATE_RESOURCE: 409,
  KNOWLEDGE_BASE_IN_USE: 409,
  INVITATION_INVALID: 410,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  RATE_LIMITED: 429,
  DAILY_CAP_EXCEEDED: 429,
  LLM_UNAVAILABLE: 503,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Only these are safe for automatic retry by clients/workers. Never retry auth, validation or quota errors. */
export const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  ApiErrorCode.LLM_UNAVAILABLE,
  ApiErrorCode.DEPENDENCY_UNAVAILABLE,
  ApiErrorCode.RATE_LIMITED,
]);

/** Body of every non-2xx REST response and of every failed Socket.IO ack. */
export interface ApiError {
  code: ApiErrorCode;
  message: string; // human readable, safe to show; never contains secrets or stack traces
  requestId: string; // same id as the structured log line
  details?: Record<string, unknown>; // e.g. { field: "email" } or { limit: 50000, used: 49800 }
}

/** Stored on documents.errorCode when ingestion ends in FAILED. */
export const DocumentErrorCode = {
  PARSE_FAILED: "PARSE_FAILED",
  ENCRYPTED_PDF: "ENCRYPTED_PDF",
  TOO_MANY_PAGES: "TOO_MANY_PAGES",
  NO_TEXT_EXTRACTED: "NO_TEXT_EXTRACTED", // e.g. scanned PDF without OCR (OCR is out of MVP scope)
  EMBEDDING_FAILED: "EMBEDDING_FAILED",
  STORAGE_READ_FAILED: "STORAGE_READ_FAILED",
} as const;

export type DocumentErrorCode = (typeof DocumentErrorCode)[keyof typeof DocumentErrorCode];

/** Thrown internally by services/repositories; the global exception filter maps this to the ApiError body. */
export class HelpFlowApiException extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HelpFlowApiException";
  }
}
