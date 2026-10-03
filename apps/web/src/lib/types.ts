// Response shapes the API returns for resources that don't have a shared DTO in @helpflow/types
// (those are mostly Prisma rows shaped by each controller — kept here, one place, matched to the
// exact fields each endpoint actually returns).
import type { CloseReason, ConversationStatus, Language } from "@helpflow/types";

export type Role = "OWNER" | "ADMIN" | "AGENT";
export type DisabledReason = "USER" | "PLAN_LIMIT" | null;
export type UnavailablePolicy = "RESUME_AI" | "COLLECT_EMAIL";
export type DocumentStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
export type PlanCode = "FREE" | "PRO" | "BUSINESS";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  quotaAnchorAt: string;
  createdAt: string;
}

export interface Member {
  id: string;
  role: Role;
  disabledReason: DisabledReason;
  createdAt: string;
  user: { id: string; email: string; name: string };
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface Chatbot {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  welcomeMessage: string | null;
  systemPrompt: string | null;
  model: string | null;
  temperature: number;
  allowedDomains: string[];
  dailyTokenCap: number | null;
  handoffTimeoutSec: number | null;
  unavailablePolicy: UnavailablePolicy;
  defaultLanguage: Language;
  disabledReason: DisabledReason;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  organizationId: string;
  knowledgeBaseId: string;
  fileName: string;
  type: "PDF" | "TXT";
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: DocumentStatus;
  errorCode: string | null;
  attempts: number;
  disabledReason: DisabledReason;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRow {
  id: string;
  organizationId: string;
  chatbotId: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  status: ConversationStatus;
  assignedAgentId: string | null;
  handoffRequestedAt: string | null;
  closedAt: string | null;
  closeReason: CloseReason | null;
  language: Language | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface UsageSummary {
  period: { start: string; end: string };
  aiTokens: { used: number; reserved: number; limit: number | null };
  conversations: { used: number; limit: number | null };
  estimatedCostMicros: number;
  chatbotsDaily: Array<{ chatbotId: string; name: string; used: number; reserved: number; cap: number }>;
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan: { code: PlanCode; name: string; maxChatbots: number | null; maxAgents: number | null; maxDocuments: number | null };
}
