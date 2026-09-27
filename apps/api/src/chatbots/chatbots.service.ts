import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { loadEnv } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { QuotaService } from "../quota/quota.service";
import type { CreateChatbotDto } from "./dto/create-chatbot.dto";
import type { UpdateChatbotDto } from "./dto/update-chatbot.dto";

@Injectable()
export class ChatbotsService {
  constructor(@Inject(QuotaService) private readonly quota: QuotaService) {}

  /** Creating a chatbot auto-creates and attaches one default knowledge base (Section 4). */
  async create(organizationId: string, dto: CreateChatbotDto) {
    await this.quota.assertResourceLimit(organizationId, "chatbots");
    return prisma.$transaction(async (tx) => {
      const chatbot = await tx.chatbot.create({ data: { organizationId, name: dto.name, allowedDomains: [] } });
      const kb = await tx.knowledgeBase.create({ data: { organizationId, name: `${dto.name} — default`, isDefault: true } });
      await tx.chatbotKnowledgeBase.create({ data: { chatbotId: chatbot.id, knowledgeBaseId: kb.id, organizationId } });
      return chatbot;
    });
  }

  async list(organizationId: string) {
    return prisma.chatbot.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  }

  async get(organizationId: string, chatbotId: string) {
    return this.requireChatbot(organizationId, chatbotId);
  }

  async update(organizationId: string, chatbotId: string, dto: UpdateChatbotDto) {
    await this.requireChatbot(organizationId, chatbotId);
    return prisma.chatbot.update({ where: { id: chatbotId }, data: dto });
  }

  async remove(organizationId: string, chatbotId: string): Promise<void> {
    await this.requireChatbot(organizationId, chatbotId);
    await prisma.chatbot.delete({ where: { id: chatbotId } });
  }

  async embedSnippet(organizationId: string, chatbotId: string) {
    await this.requireChatbot(organizationId, chatbotId);
    const widgetOrigin = loadEnv().WIDGET_ORIGIN;
    return {
      chatbotId,
      snippet: `<script src="${widgetOrigin}/loader.js" data-chatbot-id="${chatbotId}" async></script>`,
    };
  }

  async attachKnowledgeBase(organizationId: string, chatbotId: string, knowledgeBaseId: string): Promise<void> {
    await this.requireChatbot(organizationId, chatbotId);
    const kb = await prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!kb || kb.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Knowledge base not found");
    }
    await prisma.chatbotKnowledgeBase.upsert({
      where: { chatbotId_knowledgeBaseId: { chatbotId, knowledgeBaseId } },
      create: { chatbotId, knowledgeBaseId, organizationId },
      update: {},
    });
  }

  async detachKnowledgeBase(organizationId: string, chatbotId: string, knowledgeBaseId: string): Promise<void> {
    await this.requireChatbot(organizationId, chatbotId);
    await prisma.chatbotKnowledgeBase.deleteMany({ where: { chatbotId, knowledgeBaseId, organizationId } });
  }

  private async requireChatbot(organizationId: string, chatbotId: string) {
    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } });
    if (!chatbot || chatbot.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Chatbot not found");
    }
    return chatbot;
  }
}
