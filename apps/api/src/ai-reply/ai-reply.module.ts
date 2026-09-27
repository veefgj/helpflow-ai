import { Module } from "@nestjs/common";
import { AiGenLockService } from "./ai-gen-lock.service";
import { AiGenerationRegistry } from "./ai-generation-registry.service";
import { RetrievalService } from "./retrieval.service";
import { AiReplyService } from "./ai-reply.service";

@Module({
  providers: [AiGenLockService, AiGenerationRegistry, RetrievalService, AiReplyService],
  exports: [AiGenLockService, AiGenerationRegistry, RetrievalService, AiReplyService],
})
export class AiReplyModule {}
