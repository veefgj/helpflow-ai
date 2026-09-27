import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ActivatePlanResourcesDto } from "./dto/activate-plan-resources.dto";
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

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(":orgId/plan-resources/activate")
  async activatePlanResources(@Param("orgId") orgId: string, @Body() dto: ActivatePlanResourcesDto) {
    await this.quota.activatePlanResources(orgId, dto.type, dto.ids);
  }
}
