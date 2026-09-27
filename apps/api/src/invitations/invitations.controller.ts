import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, type CurrentUserPayload } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { InvitationsService } from "./invitations.service";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import { AcceptInvitationDto } from "./dto/accept-invitation.dto";

@UseGuards(OrgMembershipGuard, RolesGuard)
@Roles("OWNER", "ADMIN")
@Controller("api/orgs/:orgId/invitations")
export class OrgInvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @Post()
  async create(@Param("orgId") orgId: string, @CurrentUser() user: CurrentUserPayload, @Body() dto: CreateInvitationDto) {
    return this.invitations.create(orgId, user.userId, dto);
  }

  @Get()
  async list(@Param("orgId") orgId: string) {
    return this.invitations.list(orgId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":invitationId")
  async revoke(@Param("orgId") orgId: string, @Param("invitationId") invitationId: string) {
    await this.invitations.revoke(orgId, invitationId);
  }
}

@Controller("api/invitations")
export class InvitationsAcceptController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @HttpCode(HttpStatus.OK)
  @Post("accept")
  async accept(@CurrentUser() user: CurrentUserPayload, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(user.userId, user.userEmail, dto.token);
  }
}
