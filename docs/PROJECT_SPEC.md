# HelpFlow AI — Project Specification v1.2

Multi-tenant AI Customer Support SaaS — Build & Implementation Specification (27/09/2026)

> Source: HelpFlow_AI_Project_Spec_v1.2.pdf, transcribed in full. Where prose and an Appendix contract
> disagree, the contract file in the repository (packages/database/prisma/schema.prisma,
> packages/database/sql/0002_raw_constraints.sql, docs/api-contract.md, packages/types/socket-events.ts,
> packages/types/api-errors.ts, packages/config/defaults.ts, docs/adr/architecture-decisions.md) wins.

## 1. Project at a glance

HelpFlow AI lets a business create an AI support chatbot from its own documents, embed the chatbot on a
website, and hand a conversation to a real support agent when AI is insufficient or the customer asks for a
person.

### Core value

| Layer | What the project demonstrates |
|---|---|
| SaaS | Workspace, tenant isolation, RBAC, plans and billing |
| AI | Document ingestion, embeddings, retrieval, grounded answers, citations and a measured eval set |
| Realtime | Widget chat, agent inbox, AI-to-human handoff, ordered reconnect |
| Infrastructure | Queue/worker, durable timers, rate limits, object storage, Docker and CI/CD |

### Primary demo path

Create workspace → create chatbot → upload PDF → document becomes READY → embed widget → customer asks
→ AI answers with citation → request human → agent takes over → realtime chat → view usage → upgrade plan.

## 2. MVP scope & users

### MVP capabilities

| Capability | Included in MVP |
|---|---|
| Account & workspace | Register/login/logout, refresh rotation, workspace create/switch/update/delete, copy-link invitations |
| RBAC | Owner, Admin, Agent permissions with tenant-scoped authorization |
| Chatbot & knowledge | Chatbot CRUD, default knowledge base, PDF/TXT ingestion |
| AI support | RAG retrieval, streaming answer, validated citations, insufficiency fallback, eval set |
| Website widget | iframe embed, visitor session persistence, domain embedding policy |
| Human support | Agent inbox, handoff, accept/takeover/reassign/release/close, realtime messages |
| Commercial controls | Plans, quota reservation, AI usage metering, Stripe Test Mode, downgrade policy |
| Delivery quality | Automated tests, Docker, GitHub Actions, deployment, structured logs |

### Roles

| Role | Responsibility |
|---|---|
| Owner | Full workspace control; billing; membership; override/takeover; ownership transfer; delete workspace |
| Admin | Operational management of chatbots, documents, agents and conversations; no billing, ownership transfer or workspace deletion |
| Agent | Sees the waiting queue, accepts an unassigned waiting conversation, and replies only to conversations currently assigned to them |
| Customer | Anonymous website visitor; chats with AI; requests human support; resumes the open conversation after a page refresh |

### Explicitly out of scope

Mobile app, full CRM/ticket suite, voice call center, WhatsApp/LINE/Telegram, enterprise SSO/SAML, Kafka,
Kubernetes, microservices, multi-agent orchestration and MCP without a concrete use case.

Also removed from MVP: typing indicators and presence broadcasts, email sending (invitations are copy-link), OCR
for scanned PDFs, Google OAuth (V1.1), forgot password (behind the cut line).

## 3. System architecture

Modular monolith + worker.

| Component | Responsibility |
|---|---|
| Next.js web | Dashboard, agent inbox, settings, billing UI |
| Widget (iframe app) | Served from WIDGET_ORIGIN with per-chatbot CSP; talks to /api/widget and the /widget socket namespace |
| NestJS API | Auth, tenant context, REST, Socket.IO (/widget and /agent namespaces), RAG orchestration, billing webhooks |
| PostgreSQL + pgvector | Business data, embeddings, tenant-scoped vector retrieval, quota counters |
| Redis | BullMQ backend, rate limits, per-user socket counts, Socket.IO adapter when scaled horizontally |
| Worker | Document ingestion, conversation timers (handoff timeout, agent grace), maintenance sweeps |
| Object storage | Original uploaded files; API and worker never depend on shared local disk |
| External providers | OpenAI for chat + embeddings behind an adapter (ADR-001); Stripe Test Mode for billing |

Production rule: API and worker are independent processes built from one image. Uploaded files live in
S3-compatible object storage (R2 in production, MinIO locally — ADR-003). Every timer that must survive a
restart is a BullMQ delayed job with a deterministic job id, never an in-process setTimeout.

## 4. Core data model

Schema: Chatbot N:M KnowledgeBase → KnowledgeBase 1:N Document → Document 1:N DocumentChunk. Creating a
chatbot automatically creates and attaches one default knowledge base.

| Rule | Decision |
|---|---|
| Chunk filtering | Denormalize organizationId + knowledgeBaseId + documentId on document_chunks so vector search filters directly. |
| Embedding versioning | Store embeddingModel on every chunk. Dimension fixed by vector(1536) (ADR-001); new model = new column + re-embed job. |
| Delete KB | A knowledge base attached to any chatbot cannot be deleted (409 KNOWLEDGE_BASE_IN_USE); detach first. |
| Delete document | Two-phase and retryable: set deletedAt → delete chunks → delete object → delete row. Maintenance job retries failed purges. |
| Duplicate upload | Unique (knowledgeBaseId, checksumSha256) rejects same file twice in one KB (409 DUPLICATE_RESOURCE). |
| Disabled resources | Chatbot, Document, Membership carry disabledReason = USER \| PLAN_LIMIT \| NULL. Separate from ingestion lifecycle. |
| Customer history | New conversation created after CLOSED; agents still see previous conversations for same customer. |
| Message identity | UUID id for identity, global BIGINT seq for ordering, unique (conversationId, clientMessageId) for send idempotency. |

Tenant invariant: every business resource carries organizationId. Backend resolves org context from
authenticated membership for the :orgId path segment; client-supplied organizationId is never trusted alone.
Cross-tenant access returns 404, not 403.

## 5. Knowledge ingestion & RAG

### Document ingestion

| Step | Rule |
|---|---|
| Upload (API) | Check size ≤ 20 MB, extension, declared MIME and magic bytes (%PDF- for PDF; valid UTF-8 for TXT). Stream to object storage, insert Document (UPLOADED), enqueue job id = documentId. |
| Parse (worker) | Mark PROCESSING. Reject encrypted PDFs, > 200 pages, or no extractable text with a DocumentErrorCode (non-retryable → FAILED at once). |
| Chunk | 800 tokens, 120 overlap; keep pageNumber and chunkIndex for citations. |
| Embed + persist | Batches of 64; delete existing chunks then insert all in one transaction (idempotent re-runs). Record EMBEDDING_INGEST usage. |
| Finish | Mark READY. Transient failures retry 3× exponential backoff (5s base), then FAILED. Owner/Admin may POST .../retry. |

### Runtime retrieval

| Control | MVP rule |
|---|---|
| Retrieval scope | Only chunks of KBs attached to the active chatbot, in current org, from READY documents not disabled/deleted. |
| Distance | pgvector cosine distance (vector_cosine_ops, `<=>`): 0 = identical, larger = less similar. Order ascending; drop distance > maxCosineDistance (provisional 0.7). Passing the threshold is not proof the chunk answers the question — the model must still check the content. |
| Insufficient knowledge | If no chunk passes threshold, skip LLM, return a fixed fallback in the session language with insufficientKnowledge=true and a handoff offer. Model can also return this (including for the unanswered part of a multi-part question). |
| Strict grounding | Business facts only from supplied knowledge; rephrasing allowed; no inference, added data or new commitments. Answer the supported part of a multi-part question and offer handoff for the rest. The model may only OFFER a human; it never claims a connection — only the T2 SYSTEM message announces one. |
| Conversational intents | Code (not the model) classifies a message as small talk — greeting, thanks, goodbye, language switch, clarification — only when the WHOLE message is small talk (`packages/ai/intent.ts`). Those skip retrieval; the model gets no knowledge, is told not to state business facts, and the server discards any citations. Anything else, e.g. greeting + question, goes through retrieval. |
| Language | Conversation.language (vi/en) is set at T1 from the first message (Chatbot.defaultLanguage when ambiguous) and persisted before the AI runs. It changes only on an explicit customer request ("reply in English", "trả lời bằng tiếng Việt"), both directions, any number of times. Answers, fallback, SYSTEM transition messages and widget UI use it. NULL only on legacy rows → chatbot default. |
| Citations | Context chunks numbered [1]..[K]. Model cites only those numbers; server maps to chunkIds, drops unknown numbers. |
| Prompt hierarchy | Platform safety → tenant systemPrompt → retrieved knowledge (untrusted) → last N messages → customer message (untrusted). |
| Output format | Streamed answer text followed by JSON trailer {citations, insufficientKnowledge} parsed after stream ends. |

### RAG evaluation (Phase 2 deliverable)

Gold set of 20–30 questions in evals/rag-gold.jsonl: {question, expectedDocumentId, expectedPage,
expectedFacts[], answerable, social?, language?}. ≥5 unanswerable questions, plus short VI/EN queries and small-talk
cases. `pnpm eval:rag` reports Hit@5, citation correctness, answer correctness (expected facts stated, LLM-judged),
groundedness (every claim supported by the supplied knowledge, LLM-judged), correct- and false-refusal rates, social
routing, session-language adherence, and the distance distribution used to set maxCosineDistance.

## 6. Widget, visitor session & abuse controls

Chatbot ID is public by design; security via authorization, embedding policy, rate limits and quota.

Embed snippet:
```html
<script src="https://widget.example.com/v1/loader.js" data-chatbot-id="<chatbotId>" async></script>
<!-- loader.js injects <iframe src="https://widget.example.com/c/<chatbotId>"> -->
```

`GET /c/:chatbotId` serves iframe HTML with `Content-Security-Policy: frame-ancestors <allowedDomains>`.
Empty allowedDomains = widget cannot be embedded anywhere except dashboard preview. Not an API security
boundary; cannot stop curl/server-side requests.

| Concern | Decision |
|---|---|
| Session bootstrap | POST /api/widget/session {chatbotId, visitorToken?} → verifies chatbot enabled, creates/loads Customer, returns fresh visitor token (sliding 30d), widget config, open conversation + last messages. |
| Persistence | iframe stores token in own localStorage (key hf_visitor); no third-party cookies. |
| Token content | HMAC-signed {organizationId, chatbotId, customerId, visitorId, exp}. Token for chatbot A rejected on chatbot B. |
| Access | Customer socket/API calls authenticate with visitor token, may access only their own conversation. |
| Lazy conversation | Opening widget creates no conversation; first customer message creates it + increments counter. |
| Abuse protection | Rate limits per visitor/IP/chatbot (Appendix E), daily token cap per chatbot, monthly plan quota. |

## 7. Realtime chat & human handoff

Every transition is one conditional `UPDATE ... WHERE id=? AND organizationId=? AND status=<from>`. Zero
updated rows → 409 (CONVERSATION_ALREADY_ASSIGNED or INVALID_STATE_TRANSITION) with current state. Each
successful transition inserts a SYSTEM message and emits `conversation:updated` + `inbox:updated`.

| # | From → To | Trigger / actor | Guard and side effects |
|---|---|---|---|
| T1 | (none) → AI_ACTIVE | First customer message | Conversations quota check (402); partial unique index guarantees one open conversation per customer+chatbot. |
| T2 | AI_ACTIVE → WAITING_AGENT | Customer POST .../handoff, or a chat message that explicitly asks for a human / says yes to the AI's handoff offer (detected in code, `detectHandoffIntent`) | Cancels AI stream (INTERRUPTED). Sets handoffRequestedAt. Schedules handoff-timeout job (handoffTimeoutSec ?? 180s). |
| T3 | WAITING_AGENT → AGENT_ACTIVE | Agent accept, or Owner/Admin takeover | Sets assignedAgentId + assignedAt; removes handoff-timeout job. |
| T4 | WAITING_AGENT → AI_ACTIVE | Handoff timeout, policy RESUME_AI | SYSTEM message tells customer AI continues; AI answers again. |
| T5 | WAITING_AGENT → CLOSED | Handoff timeout, policy COLLECT_EMAIL | closeReason AGENT_UNAVAILABLE; widget shows email form (POST .../contact saves Customer.email). |
| T6 | AGENT_ACTIVE → WAITING_AGENT | Agent release, or agent-grace job fires | Clears assignedAgentId; schedules new handoff-timeout job. |
| T7 | AGENT_ACTIVE → AGENT_ACTIVE | Owner/Admin reassign or takeover | Guard: target is active member of org. Writes AuditLog row. |
| T8 | AGENT_ACTIVE → CLOSED | Assigned agent, Owner or Admin | closeReason CLOSED_BY_AGENT. |
| T9 | AI_ACTIVE → CLOSED | Maintenance job | No message for 24h (aiInactivityCloseHours); closeReason INACTIVITY. |
| T10 | AI_ACTIVE / WAITING_AGENT / AGENT_ACTIVE → CLOSED | Customer POST .../close ("End conversation" in the widget, after a confirm) | Guarded by the status just read (0 rows → 409 with current state). closeReason CLOSED_BY_CUSTOMER; clears assignedAgentId; aborts an in-flight AI stream; removes handoff-timeout and agent-grace jobs. The widget's minimize button does NOT end the conversation. |

| Situation | Rule |
|---|---|
| Customer message in WAITING_AGENT | Persisted, shown to agents; AI does not reply. |
| Customer message in AGENT_ACTIVE | Persisted, pushed to assigned agent; AI does not reply. |
| Customer message while AI streams | Rejected 409 AI_RESPONSE_IN_PROGRESS; widget disables input during stream. One AI generation per conversation (Redis lock `aigen:{conversationId}`). |
| Agent disconnect | When assigned agent's last socket closes, schedule agent-grace job (30s). Reconnect within grace removes job, keeps AGENT_ACTIVE; otherwise T6. |
| Two timers | handoffTimeoutSec: nobody accepted WAITING_AGENT. agentDisconnectGraceSec: assigned agent vanished. Never share a job. |
| Timer implementation | BullMQ delayed jobs in queue `conversation-timers`, job ids `handoff-timeout:{id}` and `agent-grace:{id}`. Job re-checks state via conditional UPDATE; stale timer harmless. |

Transport rule: state-changing commands (handoff, accept, takeover, reassign, release, close) are REST calls
(RBAC guards, 409 semantics, simple tests). Socket.IO carries `message:send` with ack and all server push.
Namespaces: `/widget` (visitor token) and `/agent` (access JWT + organizationId).

### Reconnect & ordering

| Rule | Decision |
|---|---|
| Sequence | messages.seq is a global BIGINT sequence; gaps harmless. |
| Commit order | Message inserts serialized per conversation: `SELECT ... FOR UPDATE` on conversation row, then INSERT, one transaction. |
| Sync | After reconnect, client calls `GET .../messages?afterSeq=<lastSeq>&limit=200`, repeats until <200 rows returned. seq travels as decimal string. |
| Duplicate sends | Clients generate clientMessageId (UUID), reuse on retry. Insert uses ON CONFLICT DO NOTHING, returns existing row. |
| AI streaming | STREAMING exists only on socket (ai:started/ai:chunk with index). AI message row inserted once stream ends as COMPLETED/FAILED/INTERRUPTED. |
| Mid-stream reconnect | Chunks missed during disconnect not replayed; client drops partial bubble, receives final row via ai:completed or next sync. |

### AI reply pipeline

1. Persist customer message (serialized insert), ack it.
2. Acquire ai-gen lock; reserve tokens = counted prompt tokens + maxAnswerTokens (monthly + daily, one transaction).
3. Embed the question (EMBEDDING_QUERY usage), retrieve Top-K, apply distance threshold.
4. Emit ai:started {streamId}; stream ai:chunk; enforce first-token timeout 15s and total timeout 30s; retry once only before first token.
5. Parse JSON trailer, validate citations, insert AI message (seq assigned), emit ai:completed.
6. Reconcile reservation with provider-reported usage, write AiUsage. On failure: persist partial answer as FAILED/INTERRUPTED (or nothing), emit ai:failed, release reservation.

## 8. Usage quota & billing

Enforcement in PostgreSQL: atomically reserve estimate only when used+reserved+estimate ≤ limit, on both
monthly counter and chatbot's daily counter. Output capped by max_tokens=maxAnswerTokens so estimate is an
upper bound; hard limit never exceeded. On completion reconcile to provider-reported usage; on failure
release. Every reservation settled exactly once; maintenance job releases RESERVED rows older than 10 min.

| Question | Rule |
|---|---|
| What counts as AI tokens/month? | LLM input + output tokens of chat completions. |
| Embedding tokens? | Recorded in AiUsage for cost analysis; not counted against customer-facing token quota in MVP. |
| Conversations/month | Incremented once when conversation created (T1), never per message. |
| Period | Paid plans: Stripe currentPeriodStart→End. FREE: monthly periods anchored at organizations.quotaAnchorAt. |
| Daily cap | Per chatbot per UTC day: chatbot.dailyTokenCap ?? 100,000 (reservation-based). |
| Agents limit | Counts active memberships of every role (Owner, Admin, Agent). |
| Over the limit | New conversations/AI replies → 402 QUOTA_EXCEEDED (widget offers human). Creating resource over plan → 402 PLAN_LIMIT_EXCEEDED. |

### Plans

| Limit | Free | Pro | Business |
|---|---|---|---|
| Chatbots | 1 | 5 | Custom |
| Agents (all members) | 1 | 10 | Custom |
| Documents | 5 | 100 | Custom |
| AI tokens / month | 50k | 1M | Custom |
| Conversations / month | 100 | 5,000 | Custom |

### Stripe flow

| Topic | Rule |
|---|---|
| Customer mapping | One Stripe Customer per org (organizations.stripeCustomerId), created lazily at first checkout. Checkout Session carries client_reference_id + metadata.organizationId. |
| Events handled | checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_failed, invoice.paid. |
| Idempotency | Insert event id into processed_webhook_events in same transaction as state change; duplicate returns 200 without work. |
| Ordering | For subscription events, retrieve subscription from Stripe API and upsert (convergent). Skip events older than subscriptions.lastStripeEventAt. |
| Self-service | Upgrade via Checkout; cancel/payment method via Stripe Billing Portal. Business = Contact sales (no checkout). |
| Payment failure | PAST_DUE keeps paid plan for current period; CANCELED/UNPAID moves org to FREE + downgrade policy. |

Downgrade policy: never delete resources automatically. If new plan exceeded, keep N oldest chatbots,
documents, memberships active, set disabledReason=PLAN_LIMIT on rest (Owner membership never disabled). Owner
can choose different active set (POST /plan-resources/activate). On upgrade, PLAN_LIMIT rows re-enabled up to
new limits; USER-disabled rows stay disabled.

## 9. Tenant isolation & security

### RBAC rules that matter

| Action | Owner | Admin | Agent |
|---|---|---|---|
| Manage workspace settings | Yes | Yes | No |
| Billing, delete workspace, transfer ownership | Yes | No | No |
| Invite / remove member, change role | Yes | Yes* | No |
| Manage chatbots, KBs, documents | Yes | Yes | No |
| View usage dashboard | Yes | Yes | No |
| See conversations and waiting queue | Yes | Yes | Yes |
| Accept a waiting conversation | Yes | Yes | Yes |
| Reply/release/close own assigned conversation | Yes | Yes | Yes |
| Takeover/reassign any conversation | Yes | Yes | No |

*Admin may invite/remove/change role of Admin and Agent members only; never remove Owner, grant OWNER, or
transfer ownership. Owner cannot leave/be removed before transferring ownership. All rules live in one policy
function `canManageMember(actor, target, newRole)` covered by a test matrix.

### Other security controls

| Risk | Control |
|---|---|
| Cross-tenant access | Routes `/api/orgs/:orgId/...`; guard resolves membership; repositories require organizationId; integration test Org A vs Org B for every resource + vector retrieval; response 404. |
| Malicious upload | Size/extension/MIME/magic-byte checks; worker parsing with 5-min job timeout + page cap; files never served publicly. |
| Prompt injection | Retrieved documents + customer messages are untrusted input below platform/tenant instructions; model cannot trigger actions (no tools in MVP). |
| JWT / session abuse | 15-min access JWT; refresh token rotation with family reuse detection (reuse revokes family); signed visitor token bound to one chatbot. |
| Invitations | Token stored as SHA-256 hash, 72h expiry, single use, accepting user's email must match; response INVITATION_INVALID never says which check failed. |
| Webhooks | Stripe signature verified on raw body before parsing. |
| Secrets / logging | Never log tokens/secrets/message content; structured logs include requestId, organizationId, userId, route, status, duration. |

## 10. Reliability, testing & measurable quality

### Critical scenarios

- Tenant isolation: Org A cannot read/update/delete Org B resources, incl. vector retrieval + socket rooms; 404.
- Two agents accept: exactly one conditional update succeeds; other gets 409 CONVERSATION_ALREADY_ASSIGNED.
- Concurrent message inserts: parallel customer/AI inserts commit in seq order; client sync never skips a message.
- Concurrent quota requests: reservations never push used+reserved above monthly limit or daily cap.
- LLM stream drops: message persisted INTERRUPTED/FAILED (or not at all), ai:failed emitted, reservation released.
- Socket reconnect: messages with seq>lastSeq returned once; client idempotency prevents duplicate sends.
- Handoff timeout: RESUME_AI→AI_ACTIVE; COLLECT_EMAIL closes AGENT_UNAVAILABLE; accept before timer = no-op.
- Agent disconnect: reconnect within 30s keeps AGENT_ACTIVE; otherwise WAITING_AGENT. Closing one of two tabs does nothing.
- RAG citation: every persisted citation maps to a chunk supplied to the model; unknown numbers dropped.
- Stripe duplicate/out-of-order: idempotent; subscription converges to latest provider state.
- Plan downgrade/upgrade: excess resources PLAN_LIMIT-disabled deterministically; upgrade re-enables; USER-disabled stay disabled.
- Invitation: expired/revoked/reused/email-mismatched tokens return INVITATION_INVALID.

### Test layers

| Layer | Tooling and scope |
|---|---|
| Unit | Vitest: RBAC policy matrix, chunker, citation validator, quota math, state-transition table, token estimator. |
| Integration | Vitest + real PostgreSQL/Redis (Docker Compose service in CI): repositories, raw SQL, tenant isolation, reservation races, webhook idempotency. |
| E2E | Playwright: Definition of Done path with stubbed LLM provider (deterministic stream) and Stripe test webhooks via Stripe CLI. |
| RAG eval | `pnpm eval:rag` against real provider; run manually and before releases, not on every PR. |

### Operational targets

- RAG quality: publish eval-set Hit@5, citation correctness, faithfulness, correct-refusal rate in README.
- TTFT: target P95 < 2.5s for widget answers; report test environment.
- Retrieval latency: target P95 < 150ms for vector retrieval; report dataset size and filters.
- Load test: optional if time permits.

### Failure handling

Explicitly handle: LLM/embedding timeout, Redis unavailable (rate limiter fails open for dashboard, closed
for widget AI calls), BullMQ job failure, corrupted PDF, agent disconnect, customer refresh, quota exhausted,
Stripe webhook retries. Retry only codes in RETRYABLE (Appendix D); never retry authentication, validation or
quota errors.

## 11. Implementation stack & delivery

| Layer | MVP choice |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind CSS + TanStack Query + Zustand + Socket.IO client |
| Backend | NestJS + TypeScript + REST + Socket.IO (namespaces /widget, /agent) |
| Database | PostgreSQL 16+ with pgvector ≥ 0.8, Prisma ORM 7.x, raw SQL for vectors (ADR-004) |
| AI | OpenAI chat + text-embedding-3-small (1536 dims) behind a provider adapter (ADR-001) |
| Background jobs | Redis + BullMQ + dedicated worker process (queues: document-processing, conversation-timers, maintenance) |
| File storage | Cloudflare R2 in production, MinIO locally (ADR-003) |
| Auth | Built-in email/password with argon2id, JWT + rotating refresh cookie (ADR-005) |
| Billing | Stripe Test Mode, Checkout + Billing Portal |
| Testing | Vitest + Playwright; k6 only if schedule allows |
| Observability | Structured JSON logs (pino); Sentry after core E2E flow stable |
| DevOps | Docker + GitHub Actions; Vercel (web), Railway (API, worker, Redis), Neon (Postgres) — ADR-002 |

### Monorepo

```
apps/web             Next.js dashboard + agent inbox
apps/widget           iframe app + loader.js (served from WIDGET_ORIGIN)
apps/api              NestJS REST + Socket.IO
apps/worker           BullMQ processors (ingestion, timers, maintenance)
packages/database     prisma/schema.prisma, migrations, sql/, repositories
packages/types        api-errors.ts, socket-events.ts, DTOs
packages/config       defaults.ts, env schema (zod)
packages/ui           shared React components
evals/                rag-gold.jsonl + eval runner
docs/adr/             architecture-decisions.md
```

pnpm + Turborepo for shared types/config and repeatable builds. Env vars validated at boot with zod schema in
packages/config; process exits on missing/invalid variable.

### CI/CD

- Pull request: pnpm install → lint → typecheck → unit → integration (Postgres+pgvector, Redis service containers) → build
- Main: build one Docker image → prisma migrate deploy + raw SQL migration → pgvector version check → deploy API+worker → deploy web → smoke test /health

Deployment requirement: pipeline runs DB migrations before new API version starts; fails if pgvector < 0.8.0.

Deliberately not used: GraphQL, Kafka, Kubernetes, microservices, agent frameworks.

## 12. Implementation contracts (Phase 0)

| File | Defines | Appendix |
|---|---|---|
| packages/database/prisma/schema.prisma | Tables, enums, relations, indexes | A |
| packages/database/sql/0002_raw_constraints.sql | Partial unique indexes, CHECK constraints, HNSW index, reference queries | B |
| docs/api-contract.md | REST endpoints, roles, pagination and error format | C |
| packages/types/socket-events.ts | Socket.IO namespaces, events, payloads, ack shape | C |
| packages/types/api-errors.ts | Error codes, HTTP status map, retryable set, document error codes | D |
| packages/config/defaults.ts | Every numeric default and its override precedence | E |
| docs/adr/architecture-decisions.md | ADR-001 AI provider ... ADR-005 authentication | F |

Source of truth: files above win over prose. Contract change = PR updating file + matching spec section.
Override precedence: per-chatbot DB column → environment variable → DEFAULTS. Provisional values
(maxCosineDistance, pricing) must be recalibrated before results are reported.
Serialization: IDs are UUID strings; timestamps ISO-8601 UTC; BigInt as decimal strings; no floats for money
(micro-USD integers).
Pagination: cursor-based `?cursor=<opaque>&limit=<=100>` → {items, nextCursor}. Messages use afterSeq instead.
Error format: every non-2xx response and failed ack: {code, message, requestId, details?}. requestId also in
X-Request-Id header.

Phase 0 acceptance criterion: Backend, frontend and worker compile against the shared schema, enums, event
contract, error codes and defaults; migrations apply on an empty database with pgvector; nobody needs to make
an architecture decision during Phases 1–4 that is not already recorded here or in an ADR.

## 13. Build plan & definition of done

| Phase | Scope | Effort | Acceptance criterion |
|---|---|---|---|
| 0. Contracts | schema.prisma, raw SQL, socket/error/defaults files, ADRs, monorepo skeleton, Docker Compose, CI lint/typecheck | 6–8h | Contracts compile; migrations apply on empty DB; CI green. |
| 1. Core SaaS | Auth + refresh rotation, workspace, membership, invitations, RBAC policy, tenant-scoped repositories | 20–25h | Two orgs use the app with verified isolation (404) and RBAC test matrix passes. |
| 2. Knowledge + AI | Object storage, upload, worker, parsing, chunking, embeddings, pgvector, RAG, citations, widget, eval set | 33–38h | Upload PDF → READY → widget question → grounded streamed answer with validated citation; eval report generated. |
| 3. Realtime support | Conversation/message model, socket auth, serialized inserts+seq sync, T1–T9 transitions, timers, agent inbox | 25–30h | Request human → one agent atomically accepts → realtime conversation survives reconnect and agent disconnect. |
| 4. Commercial + delivery | Reservation/reconcile, plans, downgrade policy, Stripe, critical E2E, Docker, CI/CD, deploy, README | 25–30h | Usage limits and upgrade flow work on a public deployment; CI green. |

Schedule buffer: base 109–131h, +20% integration/debugging → 130–157h range.

Cut line if schedule slips: never cut tenant isolation, quota safety, RAG citations, eval set, handoff race
handling, or the E2E demo. Cut order: forgot password → k6/load test → Sentry → Billing Portal (keep
Checkout). Google OAuth stays outside MVP.

### Definition of Done

1. Register/login and create workspace; invite an agent via copy link
2. Create chatbot; default knowledge base is attached
3. Upload PDF/TXT; worker processes it to READY
4. Embed widget on an allowed domain and establish a visitor session; embedding on another domain is blocked
5. Ask a question; RAG returns a grounded streamed answer with validated citation
6. Ask an unanswerable question; the bot says so and offers a human
7. Request human; conversation enters WAITING_AGENT and AI stops replying
8. Agent accepts atomically; customer and agent chat in realtime
9. Reconnect restores missed messages using seq
10. Usage dashboard reflects reconciled token usage and limits
11. Owner upgrades with Stripe Test Mode; subscription state is updated idempotently
12. Critical tests pass; eval results and architecture are in the README; app is publicly deployed

---

Appendices A–G (schema.prisma, raw SQL, API/socket contract, error codes, defaults, ADRs, build checklist) are
implemented verbatim as repository files — see the "Source of truth" table in Section 12. They are not
duplicated here; read them directly from the repo paths listed above.
