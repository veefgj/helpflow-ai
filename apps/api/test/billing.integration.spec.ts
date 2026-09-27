// Section 8 "Stripe flow": the parts of webhook handling we own and can verify without a live
// Stripe test-mode account — convergent subscription upsert, lastStripeEventAt ordering, the
// CANCELED/UNPAID → FREE downgrade, and webhook idempotency. Checkout/Portal session creation and
// live signature verification genuinely require a real Stripe account and are NOT covered here;
// see the comment on each test for exactly what is (and isn't) exercised.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { createTestApp } from "./utils/create-test-app";
import { BillingService } from "../src/billing/billing.service";

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

function fakeStripeSubscription(overrides: Partial<Stripe.Subscription> & { organizationId: string; priceId?: string }): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `sub_${randomUUID().slice(0, 8)}`,
    status: "active",
    cancel_at_period_end: false,
    current_period_start: now,
    current_period_end: now + 30 * 24 * 60 * 60,
    metadata: { organizationId: overrides.organizationId },
    items: { data: [{ price: { id: overrides.priceId ?? "price_replace-me" } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("Billing / Stripe webhook state sync (Phase 4, Section 8)", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const id of organizationIds) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it("upgrades an org to PRO when applySubscriptionState receives an active subscription matching PRO's price", async () => {
    const { organizationId } = await registerAndCreateOrg("billing-upgrade");
    const billing = app.get(BillingService);
    const eventCreated = Math.floor(Date.now() / 1000);

    await billing.applySubscriptionState(fakeStripeSubscription({ organizationId }), eventCreated);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true } });
    expect(sub.plan.code).toBe("PRO");
    expect(sub.status).toBe("ACTIVE");
    expect(sub.stripeSubscriptionId).not.toBeNull();
  });

  it("moves an org back to FREE when the subscription becomes CANCELED, and reconciles resource limits", async () => {
    const { ownerToken, organizationId } = await registerAndCreateOrg("billing-cancel");
    const billing = app.get(BillingService);

    await billing.applySubscriptionState(fakeStripeSubscription({ organizationId }), Math.floor(Date.now() / 1000));
    const bots = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(baseUrl).post(`/api/orgs/${organizationId}/chatbots`).set("Authorization", `Bearer ${ownerToken}`).send({ name: `Bot ${i}` });
      bots.push(res.body.id as string);
      await new Promise((r) => setTimeout(r, 5));
    }

    await billing.applySubscriptionState(fakeStripeSubscription({ organizationId, status: "canceled" }), Math.floor(Date.now() / 1000) + 1);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true } });
    expect(sub.plan.code).toBe("FREE");
    expect(sub.status).toBe("CANCELED");
    expect(sub.stripeSubscriptionId).toBeNull();

    const chatbots = await prisma.chatbot.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    expect(chatbots[0]!.disabledReason).toBeNull(); // FREE allows 1 — oldest stays active
    expect(chatbots[1]!.disabledReason).toBe("PLAN_LIMIT");
    expect(chatbots[2]!.disabledReason).toBe("PLAN_LIMIT");
  });

  it("never lets an out-of-order (older) event overwrite state applied by a newer one", async () => {
    const { organizationId } = await registerAndCreateOrg("billing-ordering");
    const billing = app.get(BillingService);

    await billing.applySubscriptionState(fakeStripeSubscription({ organizationId, status: "active" }), 1_000_000);
    await billing.applySubscriptionState(fakeStripeSubscription({ organizationId, status: "past_due" }), 500_000); // older event, arrives late

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
    expect(sub.status).toBe("ACTIVE"); // the stale past_due event never applied
  });

  it("processEvent is idempotent: a duplicate event id is a no-op and never re-fetches from Stripe", async () => {
    const { organizationId } = await registerAndCreateOrg("billing-idempotent");
    const billing = app.get(BillingService);
    const eventId = `evt_${randomUUID().slice(0, 12)}`;
    const fakeEvent = {
      id: eventId,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: { object: fakeStripeSubscription({ organizationId }) },
    } as unknown as Stripe.Event;

    // Pre-mark this event id as processed — processEvent must short-circuit before ever calling
    // stripe.subscriptions.retrieve() (which would fail against our placeholder test API key).
    await prisma.processedWebhookEvent.create({ data: { id: eventId, type: fakeEvent.type } });

    await expect(billing.processEvent(fakeEvent)).resolves.toBeUndefined();
    // Org creation already gave this org a FREE subscription row — assert the duplicate event
    // never touched it (still FREE, no Stripe subscription id attached).
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true } });
    expect(sub.plan.code).toBe("FREE");
    expect(sub.stripeSubscriptionId).toBeNull();
  });
});
