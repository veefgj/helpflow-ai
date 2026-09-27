import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { BillingService } from "./billing.service";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";

@UseGuards(OrgMembershipGuard, RolesGuard)
@Roles("OWNER")
@Controller("api/orgs/:orgId/billing")
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("subscription")
  async subscription(@Param("orgId") orgId: string) {
    return this.billing.getSubscription(orgId);
  }

  @HttpCode(HttpStatus.OK)
  @Post("checkout")
  async checkout(@Param("orgId") orgId: string, @Body() dto: CreateCheckoutDto) {
    return this.billing.createCheckoutSession(orgId, dto.planCode);
  }

  @HttpCode(HttpStatus.OK)
  @Post("portal")
  async portal(@Param("orgId") orgId: string) {
    return this.billing.createPortalSession(orgId);
  }
}
