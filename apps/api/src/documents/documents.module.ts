import { Module } from "@nestjs/common";
import { DocumentsController, KnowledgeBaseDocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  controllers: [KnowledgeBaseDocumentsController, DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
