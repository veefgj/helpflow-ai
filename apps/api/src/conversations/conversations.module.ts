import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { ConversationTimersQueueService } from "./conversation-timers-queue.service";

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationTimersQueueService],
  exports: [ConversationsService, ConversationTimersQueueService],
})
export class ConversationsModule {}
