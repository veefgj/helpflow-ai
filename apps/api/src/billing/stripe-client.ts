import Stripe from "stripe";
import { loadEnv } from "@helpflow/config";

let cached: Stripe | null = null;

/** Lazy singleton, same pattern as packages/ai's getLlmProvider() — constructing Stripe doesn't
 * itself make a network call, so this is safe to call at module load time in tests too. */
export function getStripeClient(): Stripe {
  if (!cached) cached = new Stripe(loadEnv().STRIPE_SECRET_KEY);
  return cached;
}
