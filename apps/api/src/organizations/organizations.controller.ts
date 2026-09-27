import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { CurrentUser, type CurrentUserPayload } from "../common/decorators/current-user.decorator";
import { CurrentMembership } from "../common/decorators/current-membership.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { Membership } from "@helpflow/database";
import { OrganizationsService } from "./organizations.service";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { TransferOwnershipDto } from "./dto/transfer-ownership.dto";

@Controller("api/orgs")
export class OrganizationsController {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(user.userId, dto);
  }

  @UseGuards(OrgMembershipGuard)
  @Get(":orgId")
  async get(@Param("orgId") orgId: string) {
    return prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  }

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Patch(":orgId")
  async update(@Param("orgId") orgId: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(orgId, dto);
  }

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":orgId")
  async remove(@Param("orgId") orgId: string) {
    await this.organizations.softDelete(orgId);
  }

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Get(":orgId/members")
  async listMembers(@Param("orgId") orgId: string) {
    return this.organizations.listMembers(orgId);
  }

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  @Patch(":orgId/members/:memberId")
  async updateMemberRole(
    @Param("orgId") orgId: string,
    @Param("memberId") memberId: string,
    @CurrentMembership() actor: Membership,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizations.updateMemberRole(orgId, actor, memberId, dto.role);
  }

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":orgId/members/:memberId")
  async removeMember(@Param("orgId") orgId: string, @Param("memberId") memberId: string, @CurrentMembership() actor: Membership) {
    await this.organizations.removeMember(orgId, actor, memberId);
  }

  @UseGuards(OrgMembershipGuard, RolesGuard)
  @Roles("OWNER")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(":orgId/transfer-ownership")
  async transferOwnership(@Param("orgId") orgId: string, @CurrentMembership() actor: Membership, @Body() dto: TransferOwnershipDto) {
    await this.organizations.transferOwnership(orgId, actor, dto.memberId);
  }
}
