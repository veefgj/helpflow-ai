# HelpFlow AI

Multi-tenant AI customer support SaaS — a business creates an AI support chatbot from its own
documents, embeds it on a website, and hands a conversation to a real support agent when the AI is
insufficient or the customer asks for a person.

Full specification: [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md). Where prose and a contract file
disagree, the contract file wins (see `docs/PROJECT_SPEC.md` §12).

## Status

All 5 phases are in place: shared schema/contracts, a working auth + workspace + RBAC backend, a
full RAG pipeline (ingestion → embeddings → pgvector retrieval → cited streamed answers), the full
T1–T9 realtime handoff state machine with an agent inbox, and quota/billing/delivery — all verified
end-to-end against real Postgres/Redis/S3-compatible storage (and, for the widget, a real browser),
not just typechecked.

| Phase | Scope | Status |
|---|---|---|
| 0. Contracts | schema, raw SQL, socket/error/defaults contracts, ADRs, monorepo, Docker Compose, CI | ✅ |
| 1. Core SaaS | Auth + refresh rotation, workspaces, membership, invitations, RBAC, tenant isolation | ✅ |
| 2. Knowledge + AI | Ingestion, embeddings, pgvector RAG, citations, widget, eval set | ✅ |
| 3. Realtime support | Full T1–T9 handoff state machine, timers, agent inbox | ✅ |
| 4. Commercial + delivery | Quota reservation, plan limits, Stripe billing, Docker, CI, E2E | ✅ |

**Phase 1 highlights:** email/password auth (argon2id), rotating refresh cookie with reuse-detection
(a stolen/replayed token burns the whole token family), workspace CRUD with soft delete, copy-link
invitations (SHA-256 token hash, 72h expiry, email-bound), the `canManageMember` RBAC policy (Section
9) covered by a full role matrix, and tenant isolation enforced by `OrgMembershipGuard` (cross-tenant
access returns 404, never 403).

**Phase 2 highlights:** chatbot + knowledge base CRUD (creating a chatbot auto-attaches a default
KB); document upload validated by size/extension/MIME/magic-bytes and streamed to S3-compatible
storage; a worker pipeline that parses PDF/TXT, chunks (800 tokens/120 overlap, per-page so
citations stay accurate), embeds in batches, and persists vectors via raw SQL (Prisma can't write
`vector` columns) — with BullMQ's own retry/backoff for transient failures and immediate `FAILED`
for non-retryable ones (encrypted PDF, too many pages, no text); a widget session (HMAC visitor
token) and Socket.IO `/widget` namespace that lazily creates the conversation on the first message
(T1) and streams a grounded, cited answer via `ai:started`/`ai:chunk`/`ai:completed`, validating
every citation against the chunks actually supplied to the model; a per-chatbot CSP
`frame-ancestors` embedding policy enforced by `apps/widget`'s middleware; and a real `pnpm eval:rag`
runner (Hit@5, citation correctness, LLM-judged faithfulness, correct-refusal rate) against a small
seeded knowledge base, reusing the exact retrieval/prompt/citation logic the API runs in production.
A swappable `AI_PROVIDER=fake` stub (deterministic, no network) lets the whole pipeline run and be
tested without an OpenAI key — set `AI_PROVIDER=openai` for real answers and a real eval report.

**Phase 3 highlights:** the full T1–T9 conversation state machine (Section 7), every transition a
conditional `UPDATE ... WHERE status = <from>` — two agents racing to accept the same waiting
conversation is a real, automated-tested scenario: exactly one gets `200`, the other `409
CONVERSATION_ALREADY_ASSIGNED` with the current state. A customer can request a handoff mid-AI-reply
(T2, aborting the in-flight stream); an unaccepted handoff times out into either `RESUME_AI` (T4) or
`COLLECT_EMAIL` (T5) per chatbot policy; an assigned agent's last socket disconnecting schedules a
30s grace timer (T6) that a reconnect within the window cancels; Owner/Admin can take over or
reassign any `AGENT_ACTIVE` conversation (T7, audit-logged); and idle `AI_ACTIVE` conversations
close automatically after 24h (T9). The `/agent` Socket.IO namespace gives staff a live inbox
(`inbox:updated`) and realtime replies, RBAC-checked so an agent can only reply to conversations
assigned to them. Since the timers fire in `apps/worker` — a separate process with no Socket.IO
server of its own — `@socket.io/redis-adapter` (API) and `@socket.io/redis-emitter` (worker) share
Redis-backed rooms so a worker-triggered transition still reaches connected clients live.

**Phase 4 highlights:** atomic token-reservation quota (Section 8) — a raw SQL `UPDATE ... WHERE
used+reserved+estimate <= limit RETURNING` reserves against both the org's monthly counter and the
chatbot's daily counter in one transaction before any LLM call, reconciles to the provider-reported
usage on success, releases on failure, and a maintenance sweep releases anything still `RESERVED`
past 10 minutes (a crashed stream can't permanently shrink an org's quota); `GET
/api/orgs/:orgId/usage` reports the current period's used/reserved/limit, conversations, estimated
cost and a per-chatbot daily breakdown. Plan resource limits (chatbots/documents/agents) gate
creation with `402 PLAN_LIMIT_EXCEEDED`; a downgrade never deletes anything — it disables the
newest resources beyond the new limit (`disabledReason=PLAN_LIMIT`, oldest kept active), an upgrade
re-enables the oldest disabled ones first, and `POST /plan-resources/activate` lets the Owner pick a
different active set. Stripe billing (Checkout for self-serve PRO upgrade, Billing Portal for
cancel/payment method, a convergent, idempotent webhook that re-fetches the subscription from the
Stripe API rather than trusting the event payload, `lastStripeEventAt`-ordered against out-of-order
delivery). A production Docker image (ADR-002): esbuild bundles apps/api and apps/worker together
with every `@helpflow/*` workspace package they import into one `dist/main.js` each (those packages
ship as raw `.ts` with no build step of their own), one shared image serves both services
(`SERVICE=api` or `SERVICE=worker`) — built and smoke-tested against real Postgres/Redis/LocalStack
in both modes, not just typechecked. CI now also seeds the plans, runs a LocalStack service (the
worker's document-processing tests need real S3), and builds that Docker image on every push. A
Playwright E2E test drives a real Chromium browser through the widget's actual React UI (the one
piece of frontend code in this project with real UI to test) for the RAG golden path.

**Known gaps, stated plainly:** `apps/web` (the dashboard) has no built UI yet — chatbot management,
the agent inbox, and billing pages all exist as API/Socket.IO surface only, with no frontend. Stripe
Checkout/Portal session creation and live webhook signature verification aren't covered by an
automated test — that requires the project owner's own Stripe test-mode account and CLI; the parts
of the webhook handler this project *can* verify without one (convergent subscription upsert,
stale-event ordering, downgrade-triggered resource reconciliation, idempotency) are tested directly
in `apps/api/test/billing.integration.spec.ts`. Real cloud deployment (Vercel/Railway/Neon per
ADR-002) is not something an agent can carry out — it needs the project owner's own accounts and
credentials.

## Architecture

Modular monolith + worker (`docs/PROJECT_SPEC.md` §3):

```
apps/web       Next.js dashboard + agent inbox
apps/widget    iframe chat widget + loader.js + CSP middleware
apps/api       NestJS REST + Socket.IO (/widget, /agent)
apps/worker    BullMQ processors (ingestion, conversation timers, maintenance)
packages/database  Prisma schema, raw SQL repositories (vectors, messages)
packages/types      Shared DTOs, error codes, socket event contract
packages/config     Runtime defaults, env schema (zod)
packages/ai         LLM/embedding provider adapter (+ fake stub), chunker, citations, retrieval, prompts
packages/storage    S3-compatible object storage client (R2 in prod, LocalStack locally)
packages/ui         Shared React components
evals/              RAG gold set, seed corpus, and eval runner
e2e/                Playwright browser E2E (widget RAG golden path)
docs/adr/           Architecture decision records
Dockerfile          Shared production image for apps/api and apps/worker (ADR-002)
scripts/            Build-only tooling (esbuild bundling for the Docker image)
```

## Getting started

Requires Node 24+, pnpm 9+, and Docker.

```bash
cp .env.example .env          # AI_PROVIDER=fake by default — works with no OpenAI key
docker compose up -d          # Postgres+pgvector, Redis, S3-compatible storage (ADR-003)
pnpm install
pnpm run db:generate
pnpm run db:migrate:deploy    # applies Prisma migrations + raw SQL constraints + pgvector version check
pnpm run db:seed              # seeds the Free/Pro/Business plans
pnpm run dev                  # starts web, widget, api and worker together (Turborepo)
```

For real grounded answers (and a real `pnpm eval:rag` report), set `AI_PROVIDER=openai` and a real
`OPENAI_API_KEY` in `.env`.

- Dashboard: http://localhost:3010 (not 3000 — see the comment in `.env.example`)
- API: http://localhost:4000 (health: `/health`, readiness: `/ready`)
- Widget: http://localhost:4100

## Testing

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run test:integration   # requires Postgres + Redis + object storage running
pnpm run eval:rag           # seeds a small KB and reports Hit@5/citations/faithfulness/refusal rate
pnpm run e2e                # Playwright; starts apps/api + apps/widget itself, needs Docker Compose running
```

To build and smoke-test the production image locally:

```bash
docker build -t helpflow .
docker run --network helpflow_default -e SERVICE=api  ... helpflow   # HTTP + Socket.IO on $PORT
docker run --network helpflow_default -e SERVICE=worker ... helpflow  # BullMQ consumers, no HTTP
```

`eval:rag` runs against whichever `AI_PROVIDER` is configured — meaningful for Hit@5 and
correct-refusal even with the fake stub, but citation-correctness and faithfulness need
`AI_PROVIDER=openai` for a real quality signal (the tool prints a warning when it's running against
the stub).

## Documentation

- [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) — full product & implementation specification
- [`docs/api-contract.md`](docs/api-contract.md) — REST endpoints, roles, pagination, error format
- [`docs/adr/architecture-decisions.md`](docs/adr/architecture-decisions.md) — ADR-001..005
- `packages/database/prisma/schema.prisma` — data model
- `packages/database/sql/0002_raw_constraints.sql` — partial unique indexes, CHECK constraints, HNSW index
- `packages/types/api-errors.ts`, `packages/types/socket-events.ts` — error codes & realtime contract
- `packages/config/defaults.ts` — every numeric default and its override precedence
