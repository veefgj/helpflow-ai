import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { QuotaService } from "./quota.service";

@Controller("api/orgs")
export class QuotaController {
  constructor(@Inject(QuotaService) private readonly quota: QuotaService) {}

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Get(":orgId/usage")
  async usage(@Param("orgId") orgId: string) {
    return this.quota.getUsageSummary(orgId);
  }
}
