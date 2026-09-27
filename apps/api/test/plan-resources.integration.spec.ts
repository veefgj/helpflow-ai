// Section 8 "Downgrade policy": never delete resources automatically. Downgrade disables the
// newest active rows beyond the new limit (keeping the oldest N); upgrade re-enables PLAN_LIMIT
// rows oldest-first; USER-disabled rows and the Owner's own membership are never touched.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { createTestApp } from "./utils/create-test-app";
import { QuotaService } from "../src/quota/quota.service";

let app: INestApplication;
let baseUrl: string;
const organizationIds: string[] = [];

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@test.local`;
}

async function registerAndCreateOrg(label: string) {
  const owner = await request(baseUrl).post("/api/auth/register").send({ email: uniqueEmail(label), password: "Sup3rSecret!", name: "Test Owner" });
  const ownerToken = owner.body.accessToken as string;
  const org = await request(baseUrl).post("/api/orgs").set("Authorization", `Bearer ${ownerToken}`).send({ name: `${label} Co` });
  organizationIds.push(org.body.id);
  return { ownerToken, organizationId: org.body.id as string };
}

async function upgradeToPro(organizationId: string): Promise<void> {
  const pro = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
  await prisma.subscription.update({ where: { organizationId }, data: { planId: pro.id } });
}

async function downgradeToFree(organizationId: string): Promise<void> {
  const free = await prisma.plan.findUniqueOrThrow({ where: { code: "FREE" } });
  await prisma.subscription.update({ where: { organizationId }, data: { planId: free.id } });
}

describe("Plan resource reconciliation (Phase 4, Section 8 downgrade policy)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const id of organizationIds) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it("disables the newest chatbots beyond the new limit on downgrade, and re-enables the oldest ones on upgrade", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("downgrade-chatbots");
    await upgradeToPro(organizationId); // PRO allows 5 chatbots

    const bots = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: `Bot ${i}` });
      bots.push(res.body.id as string);
      await new Promise((r) => setTimeout(r, 5)); // ensure distinct createdAt ordering
    }

    await downgradeToFree(organizationId); // FREE allows only 1
    const quota = app.get(QuotaService);
    await quota.reconcilePlanLimits(organizationId);

    const afterDowngrade = await prisma.chatbot.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    expect(afterDowngrade[0]!.disabledReason).toBeNull(); // oldest stays active
    expect(afterDowngrade[1]!.disabledReason).toBe("PLAN_LIMIT");
    expect(afterDowngrade[2]!.disabledReason).toBe("PLAN_LIMIT");

    await upgradeToPro(organizationId);
    await quota.reconcilePlanLimits(organizationId);
    const afterUpgrade = await prisma.chatbot.findMany({ where: { organizationId } });
    expect(afterUpgrade.every((b) => b.disabledReason === null)).toBe(true);
  });

  it("never re-enables a USER-disabled chatbot on upgrade, and never touches it on downgrade either", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("user-disabled");
    await upgradeToPro(organizationId);

    const bot1 = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: "Bot 1" });
    await prisma.chatbot.update({ where: { id: bot1.body.id }, data: { disabledReason: "USER" } });

    const quota = app.get(QuotaService);
    await downgradeToFree(organizationId);
    await quota.reconcilePlanLimits(organizationId);
    await upgradeToPro(organizationId);
    await quota.reconcilePlanLimits(organizationId);

    const bot1After = await prisma.chatbot.findUniqueOrThrow({ where: { id: bot1.body.id } });
    expect(bot1After.disabledReason).toBe("USER"); // untouched throughout
  });

  it("POST /plan-resources/activate lets the Owner pick a different active set than the oldest-first default", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("activate-endpoint");
    await upgradeToPro(organizationId);

    const bots = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: `Bot ${i}` });
      bots.push(res.body.id as string);
      await new Promise((r) => setTimeout(r, 5));
    }
    await downgradeToFree(organizationId);
    const quota = app.get(QuotaService);
    await quota.reconcilePlanLimits(organizationId); // default: only bots[0] active

    const activate = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/plan-resources/activate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ type: "chatbots", ids: [bots[2]] }); // owner picks the newest one instead
    expect(activate.status).toBe(204);

    const rows = await prisma.chatbot.findMany({ where: { organizationId } });
    const byId = new Map(rows.map((r) => [r.id, r.disabledReason]));
    expect(byId.get(bots[0])).toBe("PLAN_LIMIT");
    expect(byId.get(bots[1])).toBe("PLAN_LIMIT");
    expect(byId.get(bots[2])).toBeNull();
  });

  it("rejects activating more resources than the current plan limit allows", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("activate-over-limit");
    // FREE plan: maxChatbots = 1
    const activate = await request(baseUrl)
      .post(`/api/orgs/${organizationId}/plan-resources/activate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ type: "chatbots", ids: [randomUUID(), randomUUID()] });
    expect(activate.status).toBe(402);
    expect(activate.body.code).toBe("PLAN_LIMIT_EXCEEDED");
  });
});
