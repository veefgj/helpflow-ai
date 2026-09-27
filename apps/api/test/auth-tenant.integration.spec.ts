// Phase 1 acceptance criterion (Section 13): "Two organizations use the app with verified
// isolation (404) and the RBAC test matrix passes." Exercised here over real HTTP against a real
// Postgres + Redis, the same way a client would.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { createTestApp } from "./utils/create-test-app";

let app: INestApplication;
const createdUserEmails: string[] = [];

function uniqueEmail(label: string): string {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
  createdUserEmails.push(email);
  return email;
}

function extractRefreshCookie(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith("hf_rt="));
  if (!raw) throw new Error("hf_rt cookie was not set");
  return raw.split(";")[0]!; // "hf_rt=<value>"
}

async function registerAndLogin(agent: ReturnType<typeof request.agent>, email: string) {
  const res = await agent.post("/api/auth/register").send({ email, password: "Sup3rSecret!", name: "Test User" });
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

describe("Auth + tenant isolation + RBAC (Phase 1)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    await app.close();
  });

  it("registers, logs in, and GET /api/me reflects the created workspace", async () => {
    const server = app.getHttpServer();
    const owner = request.agent(server);
    const email = uniqueEmail("owner");
    const accessToken = await registerAndLogin(owner, email);

    const org = await request(server)
      .post("/api/orgs")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Acme Support" });
    expect(org.status).toBe(201);

    const me = await request(server).get("/api/me").set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0]).toMatchObject({ organizationId: org.body.id, role: "OWNER" });
  });

  it("rejects a request with no access token", async () => {
    const res = await request(app.getHttpServer()).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 404 (not 403) for a member of a different organization — cross-tenant isolation", async () => {
    const server = app.getHttpServer();

    const ownerA = request.agent(server);
    const tokenA = await registerAndLogin(ownerA, uniqueEmail("owner-a"));
    const orgA = await request(server).post("/api/orgs").set("Authorization", `Bearer ${tokenA}`).send({ name: "Org A" });

    const ownerB = request.agent(server);
    const tokenB = await registerAndLogin(ownerB, uniqueEmail("owner-b"));
    await request(server).post("/api/orgs").set("Authorization", `Bearer ${tokenB}`).send({ name: "Org B" });

    const crossAccess = await request(server).get(`/api/orgs/${orgA.body.id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(crossAccess.status).toBe(404);
    expect(crossAccess.body.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("invite → accept → RBAC: an AGENT can see their org but cannot list members", async () => {
    const server = app.getHttpServer();

    const owner = request.agent(server);
    const ownerToken = await registerAndLogin(owner, uniqueEmail("owner-inv"));
    const org = await request(server).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Invite Co" });
    const orgId = org.body.id;

    const agentEmail = uniqueEmail("agent");
    const invite = await request(server)
      .post(`/api/orgs/${orgId}/invitations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: agentEmail, role: "AGENT" });
    expect(invite.status).toBe(201);
    const token = new URL(invite.body.inviteUrl).searchParams.get("token");

    const agent = request.agent(server);
    const agentToken = await registerAndLogin(agent, agentEmail);
    const accept = await request(server).post("/api/invitations/accept").set("Authorization", `Bearer ${agentToken}`).send({ token });
    expect(accept.status).toBe(200);
    expect(accept.body.organizationId).toBe(orgId);

    const forbidden = await request(server).get(`/api/orgs/${orgId}/members`).set("Authorization", `Bearer ${agentToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("FORBIDDEN");

    const allowed = await request(server).get(`/api/orgs/${orgId}/members`).set("Authorization", `Bearer ${ownerToken}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveLength(2);
  });

  it("rejects an invitation acceptance whose email does not match the invited address", async () => {
    const server = app.getHttpServer();
    const owner = request.agent(server);
    const ownerToken = await registerAndLogin(owner, uniqueEmail("owner-mismatch"));
    const org = await request(server).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Mismatch Co" });

    const invite = await request(server)
      .post(`/api/orgs/${org.body.id}/invitations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: uniqueEmail("invited"), role: "ADMIN" });
    const token = new URL(invite.body.inviteUrl).searchParams.get("token");

    const stranger = request.agent(server);
    const strangerToken = await registerAndLogin(stranger, uniqueEmail("stranger"));
    const accept = await request(server).post("/api/invitations/accept").set("Authorization", `Bearer ${strangerToken}`).send({ token });

    expect(accept.status).toBe(410);
    expect(accept.body.code).toBe("INVITATION_INVALID");
  });

  it("rotates the refresh cookie and detects reuse of an already-rotated token", async () => {
    const server = app.getHttpServer();
    const registerRes = await request(server)
      .post("/api/auth/register")
      .send({ email: uniqueEmail("rotation"), password: "Sup3rSecret!", name: "Rotation" });
    expect(registerRes.status).toBe(201);
    const originalCookie = extractRefreshCookie(registerRes);

    const first = await request(server).post("/api/auth/refresh").set("Cookie", originalCookie);
    expect(first.status).toBe(200);
    const rotatedCookie = extractRefreshCookie(first);

    // Replay the pre-rotation cookie value — simulates a stolen/duplicated token being reused.
    const replay = await request(server).post("/api/auth/refresh").set("Cookie", originalCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/reuse detected/i);

    // The token issued by the (now-detected-as-compromised) first rotation is burned too.
    const afterReuse = await request(server).post("/api/auth/refresh").set("Cookie", rotatedCookie);
    expect(afterReuse.status).toBe(401);
  });

  it("transfers ownership: old owner becomes ADMIN, target becomes OWNER, exactly one OWNER remains", async () => {
    const server = app.getHttpServer();
    const owner = request.agent(server);
    const ownerToken = await registerAndLogin(owner, uniqueEmail("owner-transfer"));
    const org = await request(server).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Transfer Co" });
    const orgId = org.body.id;

    const adminEmail = uniqueEmail("future-owner");
    const invite = await request(server)
      .post(`/api/orgs/${orgId}/invitations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: adminEmail, role: "ADMIN" });
    const token = new URL(invite.body.inviteUrl).searchParams.get("token");
    const admin = request.agent(server);
    const adminToken = await registerAndLogin(admin, adminEmail);
    await request(server).post("/api/invitations/accept").set("Authorization", `Bearer ${adminToken}`).send({ token });

    const members = await request(server).get(`/api/orgs/${orgId}/members`).set("Authorization", `Bearer ${ownerToken}`);
    const targetMemberId = members.body.find((m: { user: { email: string } }) => m.user.email === adminEmail).id;

    const transfer = await request(server)
      .post(`/api/orgs/${orgId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberId: targetMemberId });
    expect(transfer.status).toBe(204);

    const membersAfter = await request(server).get(`/api/orgs/${orgId}/members`).set("Authorization", `Bearer ${adminToken}`);
    const roles = membersAfter.body.map((m: { user: { email: string }; role: string }) => [m.user.email, m.role]);
    expect(roles).toContainEqual([adminEmail, "OWNER"]);
    expect(roles.filter(([, role]: [string, string]) => role === "OWNER")).toHaveLength(1);
  });
});
