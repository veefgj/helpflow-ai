import { Module } from "@nestjs/common";
import { AiGenLockService } from "./ai-gen-lock.service";
import { RetrievalService } from "./retrieval.service";
import { AiReplyService } from "./ai-reply.service";

@Module({
  providers: [AiGenLockService, RetrievalService, AiReplyService],
  exports: [AiGenLockService, RetrievalService, AiReplyService],
})
export class AiReplyModule {}
