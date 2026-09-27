import { Module } from "@nestjs/common";
import { ChatbotsController } from "./chatbots.controller";
import { ChatbotsService } from "./chatbots.service";

@Module({
  controllers: [ChatbotsController],
  providers: [ChatbotsService],
  exports: [ChatbotsService],
})
export class ChatbotsModule {}
