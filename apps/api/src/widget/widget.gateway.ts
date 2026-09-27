// Section 7 "Transport rule": Socket.IO carries message:send (with ack) and all server push;
// state-changing commands (handoff etc., Phase 3) stay REST. Namespace /widget: visitor token auth.
import { Inject, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { prisma, insertMessageSerialized } from "@helpflow/database";
import { loadEnv, DEFAULTS } from "@helpflow/config";
import { ApiErrorCode } from "@helpflow/types";
import type {
  AckResult,
  WidgetSendMessagePayload,
  WidgetSendMessageResult,
} from "@helpflow/types";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { AiGenLockService } from "../ai-reply/ai-gen-lock.service";
import { AiReplyService } from "../ai-reply/ai-reply.service";
import { verifyVisitorToken, type VisitorTokenPayload } from "./visitor-token";

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

@WebSocketGateway({
  namespace: "/widget",
  cors: { origin: loadEnv().WIDGET_ORIGIN, credentials: true },
})
export class WidgetGateway implements OnGatewayConnection {
  private readonly logger = new Logger(WidgetGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(AiGenLockService) private readonly aiGenLock: AiGenLockService,
    @Inject(AiReplyService) private readonly aiReply: AiReplyService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.["visitorToken"];
    const payload = typeof token === "string" ? verifyVisitorToken(token) : null;
    if (!payload) {
      client.emit("connect_error", { code: ApiErrorCode.UNAUTHENTICATED, message: "Invalid visitor token" });
      client.disconnect(true);
      return;
    }
    client.data.visitor = payload;

    const conversation = await prisma.conversation.findFirst({
      where: { chatbotId: payload.chatbotId, customerId: payload.customerId, status: { not: "CLOSED" } },
    });
    if (conversation) {
      await client.join(conversationRoom(conversation.id));
    }
  }

  @SubscribeMessage("message:send")
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WidgetSendMessagePayload,
  ): Promise<AckResult<WidgetSendMessageResult>> {
    const visitor = client.data.visitor as VisitorTokenPayload | undefined;
    if (!visitor) {
      return { ok: false, error: { code: ApiErrorCode.UNAUTHENTICATED, message: "Not authenticated", requestId: "widget-socket" } };
    }
    if (!payload.content || payload.content.length > DEFAULTS.socket.maxMessageChars) {
      return {
        ok: false,
        error: { code: ApiErrorCode.VALIDATION_ERROR, message: `Message must be 1..${DEFAULTS.socket.maxMessageChars} characters`, requestId: "widget-socket" },
      };
    }

    // T1: lazy conversation creation on the first customer message.
    let conversation = await prisma.conversation.findFirst({
      where: { chatbotId: visitor.chatbotId, customerId: visitor.customerId, status: { not: "CLOSED" } },
    });
    const isNewConversation = !conversation;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { organizationId: visitor.organizationId, chatbotId: visitor.chatbotId, customerId: visitor.customerId },
      });
    }
    if (isNewConversation) {
      await client.join(conversationRoom(conversation.id));
    }

    if (conversation.status === "AI_ACTIVE" && (await this.aiGenLock.isLocked(conversation.id))) {
      return {
        ok: false,
        error: { code: ApiErrorCode.AI_RESPONSE_IN_PROGRESS, message: "Please wait for the current answer to finish", requestId: "widget-socket" },
      };
    }

    const message = await insertMessageSerialized({
      organizationId: visitor.organizationId,
      conversationId: conversation.id,
      clientMessageId: payload.clientMessageId,
      senderType: "CUSTOMER",
      senderId: visitor.customerId,
      content: payload.content,
    });

    this.server.to(conversationRoom(conversation.id)).emit("message:created", toMessageDto(message));

    if (conversation.status === "AI_ACTIVE") {
      const conversationId = conversation.id;
      this.aiReply
        .generateReply({
          organizationId: visitor.organizationId,
          chatbotId: visitor.chatbotId,
          conversationId,
          customerMessage: payload.content,
          callbacks: {
            onStarted: (streamId) => this.server.to(conversationRoom(conversationId)).emit("ai:started", { conversationId, streamId }),
            onChunk: (streamId, index, delta) =>
              this.server.to(conversationRoom(conversationId)).emit("ai:chunk", { conversationId, streamId, index, delta }),
            onCompleted: (msg) =>
              this.server.to(conversationRoom(conversationId)).emit("ai:completed", { conversationId, message: toMessageDto(msg) }),
            onFailed: (streamId, msg, errorMessage) =>
              this.server.to(conversationRoom(conversationId)).emit("ai:failed", {
                conversationId,
                streamId,
                message: msg ? toMessageDto(msg) : null,
                error: { code: ApiErrorCode.LLM_UNAVAILABLE, message: errorMessage, requestId: "ai-reply" },
              }),
          },
        })
        .catch((err) => this.logger.error(`AI reply pipeline crashed for conversation ${conversationId}`, err));
    }

    return { ok: true, data: { message: toMessageDto(message), conversation: toConversationDto(conversation) } };
  }
}
