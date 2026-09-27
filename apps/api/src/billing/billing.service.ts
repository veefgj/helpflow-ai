// Section 8 "Stripe flow": one Stripe Customer per org, created lazily at first checkout;
// Checkout/Portal for self-service; webhooks kept convergent by always re-fetching the
// subscription from the Stripe API rather than trusting the event payload's snapshot.
import { Inject, Injectable, Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { prisma, type SubscriptionStatus } from "@helpflow/database";
import { loadEnv } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { QuotaService } from "../quota/quota.service";
import { getStripeClient } from "./stripe-client";

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    case "incomplete":
    case "paused":
    default:
      return "INCOMPLETE";
  }
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe = getStripeClient();

  constructor(@Inject(QuotaService) private readonly quota: QuotaService) {}

  async createCheckoutSession(organizationId: string, planCode: "PRO"): Promise<{ url: string }> {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
    if (!plan.selfServe || !plan.stripePriceId) {
      throw new HelpFlowApiException(ApiErrorCode.VALIDATION_ERROR, `${planCode} is not available for self-service checkout — contact sales`);
    }

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({ name: org.name, metadata: { organizationId } });
      customerId = customer.id;
      await prisma.organization.update({ where: { id: organizationId }, data: { stripeCustomerId: customerId } });
    }

    const env = loadEnv();
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: organizationId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${env.APP_URL}/billing?checkout=success`,
      cancel_url: `${env.APP_URL}/billing?checkout=cancelled`,
      metadata: { organizationId },
      subscription_data: { metadata: { organizationId } },
    });
    if (!session.url) throw new HelpFlowApiException(ApiErrorCode.INTERNAL_ERROR, "Stripe did not return a Checkout URL");
    return { url: session.url };
  }

  async createPortalSession(organizationId: string): Promise<{ url: string }> {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (!org.stripeCustomerId) {
      throw new HelpFlowApiException(ApiErrorCode.VALIDATION_ERROR, "This organization has no billing account yet — checkout first");
    }
    const env = loadEnv();
    const session = await this.stripe.billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${env.APP_URL}/billing` });
    return { url: session.url };
  }

  async getSubscription(organizationId: string) {
    return prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  }

  /** Entry point for POST /api/webhooks/stripe: verifies the signature, then processes the event
   * idempotently. Throws on a bad signature (the controller maps that to 400). */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const env = loadEnv();
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      throw new HelpFlowApiException(ApiErrorCode.VALIDATION_ERROR, `Invalid Stripe webhook signature: ${(err as Error).message}`);
    }
    await this.processEvent(event);
  }

  /** Idempotency (Section 8): insert the event id first: a duplicate delivery hits the unique
   * constraint and returns without doing any work. */
  async processEvent(event: Stripe.Event): Promise<void> {
    try {
      await prisma.processedWebhookEvent.create({ data: { id: event.id, type: event.type } });
    } catch {
      this.logger.log(`Stripe event ${event.id} (${event.type}) already processed — skipping`);
      return;
    }

    const subscriptionId = extractSubscriptionId(event);
    if (!subscriptionId) return; // an event type we don't act on

    // Convergent: always re-fetch from the Stripe API rather than trusting the event's own
    // snapshot, so out-of-order or partial webhook payloads can never desync our state.
    const stripeSub = await this.stripe.subscriptions.retrieve(subscriptionId);
    await this.applySubscriptionState(stripeSub, event.created);
  }

  /** The part of webhook handling that's pure DB state, given an already-fetched Stripe
   * subscription — kept separate from processEvent() so it's testable without a live Stripe API
   * call (constructing a Stripe.Subscription-shaped fixture is enough). */
  async applySubscriptionState(stripeSub: Stripe.Subscription, eventCreatedUnix: number): Promise<void> {
    const organizationId = stripeSub.metadata.organizationId;
    if (!organizationId) {
      this.logger.warn(`Stripe subscription ${stripeSub.id} has no organizationId metadata — ignoring`);
      return;
    }

    const eventCreatedAt = new Date(eventCreatedUnix * 1000);
    const existing = await prisma.subscription.findUnique({ where: { organizationId } });
    if (existing?.lastStripeEventAt && existing.lastStripeEventAt > eventCreatedAt) {
      return; // a newer event already applied — never let a stale, out-of-order event overwrite it
    }

    const status = mapStripeStatus(stripeSub.status);
    // Section 8 "Payment failure": PAST_DUE keeps the paid plan for the current period;
    // CANCELED/UNPAID moves the org back to FREE.
    const movedToFree = status === "CANCELED" || status === "UNPAID";

    const priceId = stripeSub.items.data[0]?.price.id;
    const matchedPlan = priceId ? await prisma.plan.findUnique({ where: { stripePriceId: priceId } }) : null;
    const targetPlan = movedToFree || !matchedPlan ? await prisma.plan.findUniqueOrThrow({ where: { code: "FREE" } }) : matchedPlan;

    const currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
    const currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);

    await prisma.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: targetPlan.id,
        status,
        stripeSubscriptionId: movedToFree ? null : stripeSub.id,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        lastStripeEventAt: eventCreatedAt,
      },
      update: {
        planId: targetPlan.id,
        status,
        stripeSubscriptionId: movedToFree ? null : stripeSub.id,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        lastStripeEventAt: eventCreatedAt,
      },
    });

    await this.quota.reconcilePlanLimits(organizationId);
  }
}

function extractSubscriptionId(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return sub.id;
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscription = (invoice as unknown as { subscription: string | Stripe.Subscription | null }).subscription;
      return typeof subscription === "string" ? subscription : (subscription?.id ?? null);
    }
    default:
      return null;
  }
}
