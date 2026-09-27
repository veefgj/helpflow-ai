import { Controller, Headers, HttpCode, HttpStatus, Inject, Post, RawBodyRequest, Req } from "@nestjs/common";
import type { Request } from "express";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { Public } from "../common/decorators/public.decorator";
import { BillingService } from "./billing.service";

@Controller("api/webhooks/stripe")
export class StripeWebhookController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  // Raw body only (main.ts enables `rawBody: true`) — Stripe's signature is computed over the
  // exact wire bytes, so the JSON body-parser's re-serialized payload would never verify.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post()
  async handle(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    if (!req.rawBody || !signature) {
      throw new HelpFlowApiException(ApiErrorCode.VALIDATION_ERROR, "Missing Stripe signature or body");
    }
    await this.billing.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
