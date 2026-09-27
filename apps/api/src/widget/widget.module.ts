import { Module } from "@nestjs/common";
import { WidgetController } from "./widget.controller";
import { WidgetSessionService } from "./widget-session.service";
import { WidgetGateway } from "./widget.gateway";
import { AiReplyModule } from "../ai-reply/ai-reply.module";

@Module({
  imports: [AiReplyModule],
  controllers: [WidgetController],
  providers: [WidgetSessionService, WidgetGateway],
})
export class WidgetModule {}
