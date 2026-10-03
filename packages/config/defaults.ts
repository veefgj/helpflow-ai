// HelpFlow AI — Implementation Contract v1.2: runtime defaults.
// These are MVP defaults, not business truth. Precedence: per-chatbot override (DB column) → env var → DEFAULTS.
// Values marked PROVISIONAL must be recalibrated (e.g. from the RAG eval set) before being reported.

export const DEFAULTS = {
  auth: {
    accessTokenTtlSec: 15 * 60,
    refreshTokenTtlDays: 30,
    passwordMinLength: 10,
    refreshCookieName: "hf_rt", // httpOnly, Secure, SameSite=Lax, Path=/api/auth
  },

  invitation: {
    ttlHours: 72,
  },

  upload: {
    maxFileSizeMb: 20,
    maxPdfPages: 200,
    allowed: {
      PDF: { mime: ["application/pdf"], ext: [".pdf"], magic: "%PDF-" },
      TXT: { mime: ["text/plain"], ext: [".txt"], magic: null }, // must decode as UTF-8
    },
  },

  ingestion: {
    attempts: 3,
    backoff: { type: "exponential", delayMs: 5_000 },
    jobTimeoutMs: 5 * 60_000,
    embeddingBatchSize: 64,
  },

  rag: {
    chunkTokens: 800,
    chunkOverlapTokens: 120,
    topK: 5,
    efSearch: 100,
    maxCosineDistance: 0.7, // PROVISIONAL — calibrate with the eval set; chunks above it are dropped. Passing it is not proof the chunk answers the question — the model still checks.
    maxContextTokens: 4_000,
    maxAnswerTokens: 800, // also the output part of the quota reservation estimate
    historyMessages: 10, // prior turns sent to the model
    temperature: 0.2,
  },

  llm: {
    requestTimeoutMs: 30_000,
    firstTokenTimeoutMs: 15_000,
    maxRetries: 1, // only before the first token; never retry after streaming started
    retryBackoffMs: 500,
  },

  handoff: {
    waitingTimeoutSec: 180, // WAITING_AGENT with nobody accepting → apply chatbot.unavailablePolicy
    agentDisconnectGraceSec: 30, // assigned agent's LAST socket closed → back to WAITING_AGENT if not back
  },

  conversation: {
    aiInactivityCloseHours: 24, // AI_ACTIVE conversations without messages are CLOSED (INACTIVITY)
  },

  visitor: {
    tokenTtlDays: 30, // sliding: re-issued by POST /api/widget/session
    storageKey: "hf_visitor", // localStorage key inside the iframe origin
  },

  rateLimit: {
    // sliding window, Redis-backed; key → limit per window
    widgetMessagePerVisitor: { limit: 20, windowSec: 60 },
    widgetMessagePerIp: { limit: 60, windowSec: 60 },
    widgetMessagePerChatbot: { limit: 600, windowSec: 60 },
    widgetSessionPerIp: { limit: 30, windowSec: 60 },
    authPerIp: { limit: 10, windowSec: 60 },
    dashboardPerUser: { limit: 300, windowSec: 60 },
  },

  quota: {
    dailyTokenCapPerChatbot: 100_000,
    reservationStaleMin: 10,
  },

  socket: {
    pingIntervalMs: 25_000,
    pingTimeoutMs: 20_000,
    maxMessageChars: 4_000,
    syncPageSize: 200,
  },

  jobs: {
    // BullMQ queues and deterministic job ids (so timers can be cancelled and survive restarts)
    queues: {
      documentProcessing: "document-processing",
      conversationTimers: "conversation-timers",
      maintenance: "maintenance",
    },
    // Double underscore, not a colon: BullMQ rejects custom job ids containing ":" (it uses colons
    // as its own Redis key delimiter). Spec Appendix E writes these as "handoff-timeout:{id}" —
    // this is the one place prose and the runtime disagree; this file is the corrected contract.
    handoffTimeoutJobId: (conversationId: string) => `handoff-timeout__${conversationId}`,
    agentGraceJobId: (conversationId: string) => `agent-grace__${conversationId}`,
    maintenanceEveryMin: 5, // release stale reservations, close inactive AI conversations, purge deletions
  },

  plans: {
    FREE: { maxChatbots: 1, maxAgents: 1, maxDocuments: 5, monthlyAiTokens: 50_000, monthlyConversations: 100, selfServe: true },
    PRO: { maxChatbots: 5, maxAgents: 10, maxDocuments: 100, monthlyAiTokens: 1_000_000, monthlyConversations: 5_000, selfServe: true },
    BUSINESS: { maxChatbots: null, maxAgents: null, maxDocuments: null, monthlyAiTokens: null, monthlyConversations: null, selfServe: false },
  },

  pricing: {
    // micro-USD per 1M tokens, used only for estimatedCostMicros. PROVISIONAL — copy from the provider's
    // price list at setup time and keep in env/config, not in code comments.
    perMillionInput: 0,
    perMillionOutput: 0,
    perMillionEmbedding: 0,
  },
} as const;

export type Defaults = typeof DEFAULTS;

/** Resolve a per-chatbot override against DEFAULTS. */
export function resolve<T>(override: T | null | undefined, fallback: T): T {
  return override ?? fallback;
}
