// Section 6 "Session bootstrap": verifies the chatbot is enabled, creates or loads the Customer,
// returns a fresh visitor token, widget config, and the open conversation with its last messages.
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { issueVisitorToken, verifyVisitorToken } from "./visitor-token";

@Injectable()
export class WidgetSessionService {
  async bootstrap(chatbotId: string, visitorToken?: string) {
    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } });
    if (!chatbot) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Chatbot not found");
    }
    if (chatbot.disabledReason) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_DISABLED, "This chatbot is not currently available");
    }

    const presented = visitorToken ? verifyVisitorToken(visitorToken, chatbotId) : null;

    const customer = presented
      ? await prisma.customer.findFirst({ where: { id: presented.customerId, organizationId: chatbot.organizationId } })
      : null;

    const activeCustomer =
      customer ??
      (await prisma.customer.create({ data: { organizationId: chatbot.organizationId, visitorId: randomUUID() } }));

    const conversation = await prisma.conversation.findFirst({
      where: { chatbotId, customerId: activeCustomer.id, status: { not: "CLOSED" } },
    });

    const messages = conversation
      ? await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { seq: "desc" },
          take: DEFAULTS.socket.syncPageSize,
        })
      : [];

    const newVisitorToken = issueVisitorToken({
      organizationId: chatbot.organizationId,
      chatbotId,
      customerId: activeCustomer.id,
      visitorId: activeCustomer.visitorId,
    });

    return {
      visitorToken: newVisitorToken,
      config: {
        name: chatbot.name,
        welcomeMessage: chatbot.welcomeMessage,
        defaultLanguage: chatbot.defaultLanguage,
      },
      conversation: conversation ? toConversationDto(conversation) : null,
      messages: messages.reverse().map(toMessageDto),
    };
  }
}
