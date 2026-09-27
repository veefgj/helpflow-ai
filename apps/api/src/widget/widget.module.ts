import { Module } from "@nestjs/common";
import { WidgetController } from "./widget.controller";
import { WidgetSessionService } from "./widget-session.service";
import { WidgetConversationsService } from "./widget-conversations.service";
import { WidgetGateway } from "./widget.gateway";
import { AiReplyModule } from "../ai-reply/ai-reply.module";
import { ConversationsModule } from "../conversations/conversations.module";

@Module({
  imports: [AiReplyModule, ConversationsModule],
  controllers: [WidgetController],
  providers: [WidgetSessionService, WidgetConversationsService, WidgetGateway],
})
export class WidgetModule {}
