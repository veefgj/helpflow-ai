# HelpFlow AI — API contract (Implementation Contract v1.2)

All JSON. Errors follow `packages/types/api-errors.ts` (Appendix D): every non-2xx response is
`{code, message, requestId, details?}`, with `requestId` echoed in the `X-Request-Id` header.

Pagination is cursor-based: `?cursor=<opaque>&limit=<=100>` → `{items, nextCursor}`. Messages use
`?afterSeq=<seq>&limit=<=200>` instead of a cursor. IDs are UUID strings; timestamps are ISO-8601 UTC;
BigInt (seq, counters) travel as decimal strings; money is micro-USD integers, never floats.

Realtime contract (Socket.IO namespaces, events, payloads, ack shape) lives in
`packages/types/socket-events.ts`.

## Auth

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /api/auth/register | Public | {email, password, name} → user + access token; sets refresh cookie |
| POST | /api/auth/login | Public | Rate limited per IP |
| POST | /api/auth/refresh | Refresh cookie | Rotates refresh token; reuse revokes the family |
| POST | /api/auth/logout | Authenticated | Revokes the current refresh token |
| GET | /api/me | Authenticated | User + memberships (org, role, disabledReason) |

## Organizations & members

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /api/orgs | Authenticated | Creates org, OWNER membership and FREE subscription |
| PATCH / DELETE | /api/orgs/:orgId | Owner/Admin · Owner | Update settings · soft delete (cleanup job) |
| GET | /api/orgs/:orgId/members | Owner/Admin | List members |
| PATCH / DELETE | /api/orgs/:orgId/members/:memberId | Owner/Admin* | Change role · remove (policy function) |
| POST | /api/orgs/:orgId/transfer-ownership | Owner | {memberId} → target becomes OWNER, caller becomes ADMIN |
| POST / GET | /api/orgs/:orgId/invitations | Owner/Admin | Create → returns inviteUrl once · list pending |
| DELETE | /api/orgs/:orgId/invitations/:id | Owner/Admin | Revoke |
| POST | /api/invitations/accept | Authenticated | {token}; email must match |

## Chatbots & knowledge

| Method | Path | Who | Notes |
|---|---|---|---|
| GET / POST | /api/orgs/:orgId/chatbots | Member · Owner/Admin | List · create (+ default KB); PLAN_LIMIT_EXCEEDED |
| GET / PATCH / DELETE | /api/orgs/:orgId/chatbots/:id | Member · Owner/Admin | Includes allowedDomains, caps, unavailablePolicy |
| GET | /api/orgs/:orgId/chatbots/:id/embed | Owner/Admin | Embed snippet |
| PUT / DELETE | /api/orgs/:orgId/chatbots/:id/knowledge-bases/:kbId | Owner/Admin | Attach · detach |
| GET / POST | /api/orgs/:orgId/knowledge-bases | Owner/Admin | List · create |
| DELETE | /api/orgs/:orgId/knowledge-bases/:kbId | Owner/Admin | 409 KNOWLEDGE_BASE_IN_USE if attached |
| POST | /api/orgs/:orgId/knowledge-bases/:kbId/documents | Owner/Admin | multipart/form-data file; 201 UPLOADED |
| GET | /api/orgs/:orgId/knowledge-bases/:kbId/documents | Owner/Admin | List with status and errorCode |
| POST / DELETE | /api/orgs/:orgId/documents/:id(/retry) | Owner/Admin | Retry FAILED · two-phase delete |

## Conversations (agent side)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/orgs/:orgId/conversations | Member | ?status=&assigned=me&cursor= — inbox tabs All / Waiting / Mine / AI / Closed |
| GET | /api/orgs/:orgId/conversations/:id | Member | Conversation + customer |
| GET | /api/orgs/:orgId/conversations/:id/messages | Member | ?afterSeq=&limit= (sync and history) |
| GET | /api/orgs/:orgId/customers/:id/conversations | Member | Previous conversations of the customer |
| POST | /api/orgs/:orgId/conversations/:id/accept | Member | T3; 409 CONVERSATION_ALREADY_ASSIGNED |
| POST | /api/orgs/:orgId/conversations/:id/takeover | Owner/Admin | T3 or T7 to self |
| POST | /api/orgs/:orgId/conversations/:id/reassign | Owner/Admin | {agentUserId} — T7 |
| POST | /api/orgs/:orgId/conversations/:id/release | Assigned agent, Owner/Admin | T6 |
| POST | /api/orgs/:orgId/conversations/:id/close | Assigned agent, Owner/Admin | T8 |

## Usage & billing

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /api/orgs/:orgId/usage | Owner/Admin | Current period used/reserved/limit, conversations, estimated cost, daily per chatbot |
| GET | /api/orgs/:orgId/billing/subscription | Owner | Plan, status, period |
| POST | /api/orgs/:orgId/billing/checkout | Owner | {planCode: PRO} → Checkout URL |
| POST | /api/orgs/:orgId/billing/portal | Owner | Billing Portal URL |
| POST | /api/orgs/:orgId/plan-resources/activate | Owner | {type, ids[]} choose the active set after downgrade |
| POST | /api/webhooks/stripe | Stripe signature | Raw body; idempotent |

## Widget (customer side)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /c/:chatbotId | Public | iframe HTML with per-chatbot CSP frame-ancestors |
| POST | /api/widget/session | Public (rate limited) | {chatbotId, visitorToken?} → {visitorToken, config, conversation?, messages} |
| GET | /api/widget/conversations/current/messages | Visitor token | ?afterSeq=&limit= |
| POST | /api/widget/conversations/:id/handoff | Visitor token | T2 |
| POST | /api/widget/conversations/:id/contact | Visitor token | {email, name?} after T5 |

## Operations

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /health · /ready | Public | Liveness · readiness (DB, Redis) |
