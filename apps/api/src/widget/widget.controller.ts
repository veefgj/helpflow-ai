import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { prisma, listMessagesAfterSeq } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { toMessageDto } from "../common/mappers/message.mapper";
import { WidgetSessionService } from "./widget-session.service";
import { BootstrapSessionDto } from "./dto/bootstrap-session.dto";
import { VisitorAuthGuard } from "./visitor-auth.guard";
import { CurrentVisitor } from "./current-visitor.decorator";
import type { VisitorTokenPayload } from "./visitor-token";

@Public()
@Controller("api/widget")
export class WidgetController {
  constructor(@Inject(WidgetSessionService) private readonly session: WidgetSessionService) {}

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
}
