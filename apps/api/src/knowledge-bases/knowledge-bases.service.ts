import { Injectable } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import type { CreateKnowledgeBaseDto } from "./dto/create-knowledge-base.dto";

@Injectable()
export class KnowledgeBasesService {
  async create(organizationId: string, dto: CreateKnowledgeBaseDto) {
    return prisma.knowledgeBase.create({ data: { organizationId, name: dto.name } });
  }

  async list(organizationId: string) {
    return prisma.knowledgeBase.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  }

  /** A knowledge base attached to any chatbot cannot be deleted — detach it first (Section 4). */
  async remove(organizationId: string, knowledgeBaseId: string): Promise<void> {
    const kb = await prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!kb || kb.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Knowledge base not found");
    }

    const attachedCount = await prisma.chatbotKnowledgeBase.count({ where: { knowledgeBaseId } });
    if (attachedCount > 0) {
      throw new HelpFlowApiException(ApiErrorCode.KNOWLEDGE_BASE_IN_USE, "Detach this knowledge base from its chatbots first");
    }

    await prisma.knowledgeBase.delete({ where: { id: knowledgeBaseId } });
  }
}
