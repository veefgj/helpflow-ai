# HelpFlow AI

Multi-tenant AI customer support SaaS — a business creates an AI support chatbot from its own
documents, embeds it on a website, and hands a conversation to a real support agent when the AI is
insufficient or the customer asks for a person.

Full specification: [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md). Where prose and a contract file
disagree, the contract file wins (see `docs/PROJECT_SPEC.md` §12).

## Status

Phases 0–1 are in place: shared schema/contracts, monorepo/CI skeleton, and a working auth +
workspace + RBAC backend verified end-to-end (real Postgres/Redis, real HTTP requests). Remaining
product features (RAG, realtime handoff, billing) are built out phase by phase per the build plan in
`docs/PROJECT_SPEC.md` §13.

| Phase | Scope | Status |
|---|---|---|
| 0. Contracts | schema, raw SQL, socket/error/defaults contracts, ADRs, monorepo, Docker Compose, CI | ✅ |
| 1. Core SaaS | Auth + refresh rotation, workspaces, membership, invitations, RBAC, tenant isolation | ✅ |
| 2. Knowledge + AI | Ingestion, embeddings, pgvector RAG, citations, widget, eval set | ⏳ |
| 3. Realtime support | Conversations, socket auth, handoff state machine, agent inbox | ⏳ |
| 4. Commercial + delivery | Quota reservation, plans, Stripe, E2E, deploy | ⏳ |

Phase 1 highlights: email/password auth (argon2id), rotating refresh cookie with reuse-detection
(a stolen/replayed token burns the whole token family), workspace CRUD with soft delete, copy-link
invitations (SHA-256 token hash, 72h expiry, email-bound), the `canManageMember` RBAC policy (Section
9) covered by a full role matrix, and tenant isolation enforced by `OrgMembershipGuard` (cross-tenant
access returns 404, never 403).

## Architecture

Modular monolith + worker (`docs/PROJECT_SPEC.md` §3):

```
apps/web       Next.js dashboard + agent inbox
apps/widget    iframe chat widget + loader.js
apps/api       NestJS REST + Socket.IO (/widget, /agent)
apps/worker    BullMQ processors (ingestion, conversation timers, maintenance)
packages/database  Prisma schema, raw SQL, repositories
packages/types      Shared DTOs, error codes, socket event contract
packages/config     Runtime defaults, env schema (zod)
packages/ui         Shared React components
evals/              RAG gold set + eval runner
docs/adr/           Architecture decision records
```

## Getting started

Requires Node 24+, pnpm 9+, and Docker.

```bash
cp .env.example .env          # fill in OPENAI_API_KEY at minimum for AI features
docker compose up -d          # Postgres+pgvector, Redis, MinIO
pnpm install
pnpm run db:generate
pnpm run db:migrate:deploy    # applies Prisma migrations + raw SQL constraints + pgvector version check
pnpm run db:seed              # seeds the Free/Pro/Business plans
pnpm run dev                  # starts web, widget, api and worker together (Turborepo)
```

- Dashboard: http://localhost:3000
- API: http://localhost:4000 (health: `/health`, readiness: `/ready`)
- Widget: http://localhost:4100

## Testing

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run test:integration   # requires Postgres + Redis running
pnpm run eval:rag           # RAG quality report (Phase 2+, real OpenAI key required)
```

## Documentation

- [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) — full product & implementation specification
- [`docs/api-contract.md`](docs/api-contract.md) — REST endpoints, roles, pagination, error format
- [`docs/adr/architecture-decisions.md`](docs/adr/architecture-decisions.md) — ADR-001..005
- `packages/database/prisma/schema.prisma` — data model
- `packages/database/sql/0002_raw_constraints.sql` — partial unique indexes, CHECK constraints, HNSW index
- `packages/types/api-errors.ts`, `packages/types/socket-events.ts` — error codes & realtime contract
- `packages/config/defaults.ts` — every numeric default and its override precedence
