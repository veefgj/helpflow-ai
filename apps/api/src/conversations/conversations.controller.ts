import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentMembership } from "../common/decorators/current-membership.decorator";
import { CurrentUser, type CurrentUserPayload } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { OrgMembershipGuard } from "../common/guards/org-membership.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { toMessageDto } from "../common/mappers/message.mapper";
import type { Membership } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ConversationsService } from "./conversations.service";
import { ReassignDto } from "./dto/reassign.dto";

@UseGuards(OrgMembershipGuard)
@Controller("api/orgs/:orgId")
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly conversations: ConversationsService) {}

  @Get("conversations")
  async list(@Param("orgId") orgId: string, @Query("status") status?: string, @Query("assigned") assigned?: string, @CurrentUser() user?: CurrentUserPayload) {
    return this.conversations.list(orgId, { status, assignedToMe: assigned === "me" ? user?.userId : undefined });
  }

  @Get("conversations/:conversationId")
  async get(@Param("orgId") orgId: string, @Param("conversationId") conversationId: string) {
    return this.conversations.get(orgId, conversationId);
  }

  @Get("conversations/:conversationId/messages")
  async messages(
    @Param("orgId") orgId: string,
    @Param("conversationId") conversationId: string,
    @Query("afterSeq") afterSeq?: string,
    @Query("limit") limit?: string,
  ) {
    const rows = await this.conversations.messages(
      orgId,
      conversationId,
      BigInt(afterSeq ?? "0"),
      Math.min(Number(limit ?? DEFAULTS.socket.syncPageSize), DEFAULTS.socket.syncPageSize),
    );
    return { items: rows.map(toMessageDto) };
  }

  @Get("customers/:customerId/conversations")
  async customerConversations(@Param("orgId") orgId: string, @Param("customerId") customerId: string) {
    return this.conversations.customerConversations(orgId, customerId);
  }

  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/accept")
  async accept(@Param("orgId") orgId: string, @Param("conversationId") conversationId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.conversations.accept(orgId, conversationId, user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/takeover")
  async takeover(@Param("orgId") orgId: string, @Param("conversationId") conversationId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.conversations.takeover(orgId, conversationId, user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/reassign")
  async reassign(
    @Param("orgId") orgId: string,
    @Param("conversationId") conversationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ReassignDto,
  ) {
    return this.conversations.reassign(orgId, conversationId, user.userId, dto.agentUserId);
  }

  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/release")
  async release(
    @Param("orgId") orgId: string,
    @Param("conversationId") conversationId: string,
    @CurrentMembership() actor: Membership,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.conversations.release(orgId, conversationId, actor, user.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/close")
  async close(
    @Param("orgId") orgId: string,
    @Param("conversationId") conversationId: string,
    @CurrentMembership() actor: Membership,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.conversations.close(orgId, conversationId, actor, user.userId);
  }
}
