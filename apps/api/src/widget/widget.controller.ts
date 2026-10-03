import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { prisma, listMessagesAfterSeq } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { WidgetSessionService } from "./widget-session.service";
import { WidgetConversationsService } from "./widget-conversations.service";
import { BootstrapSessionDto } from "./dto/bootstrap-session.dto";
import { ContactDto } from "./dto/contact.dto";
import { VisitorAuthGuard } from "./visitor-auth.guard";
import { CurrentVisitor } from "./current-visitor.decorator";
import type { VisitorTokenPayload } from "./visitor-token";

@Public()
@Controller("api/widget")
export class WidgetController {
  constructor(
    @Inject(WidgetSessionService) private readonly session: WidgetSessionService,
    @Inject(WidgetConversationsService) private readonly conversations: WidgetConversationsService,
  ) {}

  // Public and unauthenticated by necessity: the widget iframe (apps/widget) reads this to set its
  // own Content-Security-Policy: frame-ancestors header (Section 6 "Embedding policy") before any
  // visitor identity exists yet.
  @Get("chatbots/:chatbotId/embed-policy")
  async embedPolicy(@Param("chatbotId") chatbotId: string) {
    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { allowedDomains: true, disabledReason: true } });
    if (!chatbot || chatbot.disabledReason) {
      return { allowedDomains: [] as string[] };
    }
    return { allowedDomains: chatbot.allowedDomains };
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: "widget-session", ...DEFAULTS.rateLimit.widgetSessionPerIp, failOpen: false })
  @Post("session")
  async bootstrap(@Body() dto: BootstrapSessionDto) {
    return this.session.bootstrap(dto.chatbotId, dto.visitorToken);
  }

  @UseGuards(VisitorAuthGuard)
  @Get("conversations/current/messages")
  async currentMessages(@CurrentVisitor() visitor: VisitorTokenPayload, @Query("afterSeq") afterSeq?: string, @Query("limit") limit?: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { chatbotId: visitor.chatbotId, customerId: visitor.customerId, status: { not: "CLOSED" } },
    });
    if (!conversation) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "No open conversation");
    }

    const rows = await listMessagesAfterSeq(
      conversation.id,
      BigInt(afterSeq ?? "0"),
      Math.min(Number(limit ?? DEFAULTS.socket.syncPageSize), DEFAULTS.socket.syncPageSize),
    );
    return { items: rows.map(toMessageDto) };
  }

  @UseGuards(VisitorAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/handoff")
  async handoff(@CurrentVisitor() visitor: VisitorTokenPayload, @Param("conversationId") conversationId: string) {
    return this.conversations.requestHandoff(visitor, conversationId);
  }

  @UseGuards(VisitorAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post("conversations/:conversationId/close")
  async close(@CurrentVisitor() visitor: VisitorTokenPayload, @Param("conversationId") conversationId: string) {
    return toConversationDto(await this.conversations.closeByCustomer(visitor, conversationId));
  }

  @UseGuards(VisitorAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("conversations/:conversationId/contact")
  async contact(@CurrentVisitor() visitor: VisitorTokenPayload, @Param("conversationId") conversationId: string, @Body() dto: ContactDto) {
    await this.conversations.saveContact(visitor, conversationId, dto.email, dto.name);
  }
}
