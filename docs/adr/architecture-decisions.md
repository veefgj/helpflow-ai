# HelpFlow AI — Architecture Decision Records

## ADR-001 — AI provider

| Field | Content |
|---|---|
| Status | Accepted |
| Decision | OpenAI for both chat and embeddings in the MVP, behind `LlmProvider` / `EmbeddingProvider` interfaces (one implementation each). Embeddings: `text-embedding-3-small`, 1536 dimensions → locks `vector(1536)`. Chat model is configuration (`LLM_CHAT_MODEL`), chosen at setup as a small, low-cost model with streaming and JSON/structured output. |
| Reason | One vendor for both calls keeps keys, billing and failure modes simple; the adapter keeps a later switch contained. |
| Consequences | Changing the embedding model or dimension requires a new column and a re-embed job (`embeddingModel` is stored on every chunk). Reservation estimate = counted input tokens + maxAnswerTokens; reconciliation uses the provider-reported usage. |
| Env | `OPENAI_API_KEY`, `LLM_CHAT_MODEL`, `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIM=1536` |

## ADR-002 — Production deployment

| Field | Content |
|---|---|
| Status | Accepted |
| Decision | Web (Next.js) on Vercel. API and worker as two services built from the same Docker image on Railway, plus Railway Redis. PostgreSQL on Neon with pgvector, in the region closest to Railway. |
| Reason | Managed services with free/cheap tiers, Docker-native deploys for long-lived Socket.IO and worker processes, and Postgres with pgvector ≥ 0.8. |
| Consequences | MVP runs one API replica. Scaling to more replicas requires sticky sessions and `@socket.io/redis-adapter`. CI runs `prisma migrate deploy`, applies the raw SQL migration and fails if `SELECT extversion FROM pg_extension WHERE extname='vector'` is below 0.8.0. Until Phase 4's Docker image exists, `apps/api`/`apps/worker`'s `start` scripts run their TypeScript entrypoint directly via `tsx` (the same way `dev` does) rather than `node dist/main.js`, because the internal workspace packages (`@helpflow/config`, `@helpflow/types`, `@helpflow/database`) ship as raw `.ts` with no build step yet — plain Node can't resolve their extensionless relative imports. Phase 4 either adds a build step to those packages or bundles the API/worker with esbuild before this matters for a real container. |
| Env | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `REDIS_URL`, `APP_URL`, `API_URL`, `WIDGET_ORIGIN`, `JWT_ACCESS_SECRET`, `VISITOR_TOKEN_SECRET`, `SENTRY_DSN` (optional) |

## ADR-003 — Object storage

| Field | Content |
|---|---|
| Status | Accepted |
| Decision | Cloudflare R2 in production, an S3-compatible emulator in local Docker Compose, both through the S3 API (`@aws-sdk/client-s3`). Private bucket, no public URLs. The API streams the validated upload to storage; the worker reads by key. |
| Reason | S3-compatible, no egress fees, and the same client code in dev and prod. |
| Consequences | Key format `org/{orgId}/kb/{kbId}/doc/{docId}/{sha256}.{ext}`. Deletion is two-phase (mark deletedAt → purge chunks → delete object → delete row) and retried by the maintenance job. Local emulator: MinIO was the original choice, but MinIO Inc. gated their public Docker images behind login in 2025 (both `docker.io/minio/minio` and `quay.io/minio/minio` now require authentication for anonymous pulls); `docker-compose.yml` uses `localstack/localstack` (S3 service only) instead, which is freely pullable and speaks the same S3 API. Nothing in application code depends on which emulator runs locally — swap the compose service back to a MinIO image if you have credentials for it. |
| Env | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (true for MinIO) |

## ADR-004 — ORM and vector access

| Field | Content |
|---|---|
| Status | Accepted |
| Decision | Prisma ORM 7.x for relational data; raw SQL (`$queryRaw` / `$executeRaw`) for vector reads/writes, partial unique indexes and the HNSW index. All tenant-owned access goes through repositories that take `organizationId` as a required argument. |
| Reason | Prisma speeds up CRUD; pgvector operators are not supported by the Prisma query API. |
| Consequences | Raw SQL lives only in repository files, is covered by integration tests against a real Postgres (Testcontainers or the Docker Compose DB), and always filters by `organizationId`. Postgres RLS is deferred to the security-hardening path. |

## ADR-005 — Authentication

| Field | Content |
|---|---|
| Status | Accepted |
| Decision | Built-in email + password (argon2id). Access JWT (15 min) in memory on the client; opaque refresh token in an httpOnly, Secure, SameSite=Lax cookie with rotation and family-based reuse detection. Widget customers use a signed visitor token (HMAC, 30-day sliding TTL) stored in the iframe origin's localStorage. |
| Reason | No external auth dependency in the MVP; the design demonstrates token lifecycle handling. |
| Consequences | No email sending: invitations are copy-link; forgot password is behind the cut line. Google OAuth is V1.1. |
