-- HelpFlow AI — raw SQL that Prisma schema cannot express. Apply as a migration after the Prisma baseline.
-- Requires pgvector >= 0.8 (iterative index scans). CI must fail if this check fails:
--   SELECT extversion FROM pg_extension WHERE extname = 'vector'; -- expect >= 0.8.0

-- 1) Exactly one OWNER per organization
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_owner_per_org
  ON memberships ("organizationId") WHERE role = 'OWNER';

-- 2) At most one open conversation per customer per chatbot
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_per_customer
  ON conversations ("chatbotId", "customerId") WHERE status <> 'CLOSED';

-- 3) Invariant: assignedAgentId is set if and only if the conversation is AGENT_ACTIVE
ALTER TABLE conversations ADD CONSTRAINT conversations_assignment_matches_status
  CHECK ((status = 'AGENT_ACTIVE') = ("assignedAgentId" IS NOT NULL));

-- 4) Quota counters can never go negative
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_non_negative
  CHECK ("aiTokensUsed" >= 0 AND "aiTokensReserved" >= 0);

-- 5) Vector index (cosine distance). Distance: 0 = identical, larger = less similar.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- ─────────────────── Reference queries (implemented in repositories, not migrations) ───────────────────

-- Q1. Retrieval (run inside one transaction so SET LOCAL applies)
-- BEGIN;
--   SET LOCAL hnsw.ef_search = 100;
--   SET LOCAL hnsw.iterative_scan = relaxed_order;
--   SELECT c.id, c."documentId", c."pageNumber", c."chunkIndex", c.content,
--          c.embedding <=> $1::vector AS distance
--   FROM document_chunks c
--   JOIN documents d ON d.id = c."documentId"
--   WHERE c."organizationId" = $2
--     AND c."knowledgeBaseId" = ANY($3::text[])   -- KBs attached to the active chatbot
--     AND d.status = 'READY' AND d."disabledReason" IS NULL AND d."deletedAt" IS NULL
--   ORDER BY c.embedding <=> $1::vector
--   LIMIT $4;                                      -- DEFAULTS.rag.topK
-- COMMIT;
-- relaxed_order may return rows slightly out of order: re-sort by distance in the application,
-- then drop rows with distance > maxCosineDistance.

-- Q2. Insert a message (serialized per conversation)
-- BEGIN;
--   SELECT status FROM conversations WHERE id = $1 AND "organizationId" = $2 FOR UPDATE;
--   INSERT INTO messages (id, "organizationId", "conversationId", "clientMessageId", "senderType",
--                          "senderId", content, "streamStatus", citations, "createdAt")
--   VALUES (...)
--   ON CONFLICT ("conversationId", "clientMessageId") DO NOTHING
--   RETURNING *;                                    -- 0 rows → duplicate send: SELECT and return the existing row
--   UPDATE conversations SET "lastMessageAt" = now() WHERE id = $1;
-- COMMIT;

-- Q3. Accept a waiting conversation (atomic; 0 rows → 409 CONVERSATION_ALREADY_ASSIGNED)
-- UPDATE conversations
-- SET status = 'AGENT_ACTIVE', "assignedAgentId" = $3, "assignedAt" = now(), "updatedAt" = now()
-- WHERE id = $1 AND "organizationId" = $2 AND status = 'WAITING_AGENT'
-- RETURNING *;

-- Q4. Reserve tokens (monthly + daily in one transaction; any 0-row result → ROLLBACK)
-- BEGIN;
--   UPDATE usage_counters SET "aiTokensReserved" = "aiTokensReserved" + $est
--   WHERE id = $counterId AND "aiTokensUsed" + "aiTokensReserved" + $est <= $monthlyLimit
--   RETURNING id;                                   -- 0 rows → QUOTA_EXCEEDED
--   INSERT INTO chatbot_daily_usage ("chatbotId", day, "organizationId") VALUES ($bot, $day, $org)
--   ON CONFLICT DO NOTHING;
--   UPDATE chatbot_daily_usage SET "aiTokensReserved" = "aiTokensReserved" + $est
--   WHERE "chatbotId" = $bot AND day = $day AND "aiTokensUsed" + "aiTokensReserved" + $est <= $dailyCap
--   RETURNING "chatbotId";                          -- 0 rows → DAILY_CAP_EXCEEDED
--   INSERT INTO token_reservations (...) VALUES (...);
-- COMMIT;
-- Reconcile/release: in one transaction, UPDATE token_reservations ... WHERE id = $r AND status = 'RESERVED'
-- (0 rows → already settled, do nothing), then move $est out of reserved and add $actual to used
-- on both counters.

-- Q5. Stripe webhook idempotency
-- INSERT INTO processed_webhook_events (id, type) VALUES ($eventId, $type)
-- ON CONFLICT (id) DO NOTHING RETURNING id;         -- 0 rows → already processed, return 200
-- Run in the SAME transaction as the subscription update; if processing throws, the insert rolls
-- back and Stripe's retry can process the event again.
