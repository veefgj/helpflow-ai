// Section 7 "Transport rule": Socket.IO carries message:send (with ack) and all server push;
// state-changing commands (handoff, accept, takeover, reassign, release, close) stay REST.
// Namespace /widget: visitor token auth.
import { Inject, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { prisma, insertMessageSerialized } from "@helpflow/database";
import { loadEnv, DEFAULTS } from "@helpflow/config";
import { ApiErrorCode } from "@helpflow/types";
import type { AckResult, WidgetSendMessagePayload, WidgetSendMessageResult } from "@helpflow/types";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { conversationRoom, RealtimeEmitterService } from "../common/realtime/realtime-emitter.service";
import { AiGenLockService } from "../ai-reply/ai-gen-lock.service";
import { AiReplyService } from "../ai-reply/ai-reply.service";
import { verifyVisitorToken, type VisitorTokenPayload } from "./visitor-token";

@WebSocketGateway({
  namespace: "/widget",
  cors: { origin: loadEnv().WIDGET_ORIGIN, credentials: true },
})
export class WidgetGateway implements OnGatewayConnection, OnGatewayInit {
  private readonly logger = new Logger(WidgetGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(AiGenLockService) private readonly aiGenLock: AiGenLockService,
    @Inject(AiReplyService) private readonly aiReply: AiReplyService,
    @Inject(RealtimeEmitterService) private readonly realtime: RealtimeEmitterService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.registerWidgetServer(server);
    // Namespace middleware runs BEFORE the client's own "connect" event fires, so a bad token
    // produces a real connect_error on the client instead of a connect immediately followed by a
    // disconnect (handleConnection, a lifecycle hook, only runs after "connect" already fired).
    server.use((socket, next) => {
      const token = socket.handshake.auth?.["visitorToken"];
      const payload = typeof token === "string" ? verifyVisitorToken(token) : null;
      if (!payload) {
        next(new Error("Invalid visitor token"));
        return;
      }
      socket.data.visitor = payload;
      next();
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const payload = client.data.visitor as VisitorTokenPayload;
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
        error: {
          code: ApiErrorCode.VALIDATION_ERROR,
          message: `Message must be 1..${DEFAULTS.socket.maxMessageChars} characters`,
          requestId: "widget-socket",
        },
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

    // Section 7 "Customer message while AI streams" — WAITING_AGENT/AGENT_ACTIVE never trigger the
    // AI, so the lock only matters (and is only ever held) while the conversation is AI_ACTIVE.
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

    this.realtime.emitToConversation(conversation.id, "message:created", toMessageDto(message));

    if (conversation.status === "AI_ACTIVE") {
      const conversationId = conversation.id;
      this.aiReply
        .generateReply({
          organizationId: visitor.organizationId,
          chatbotId: visitor.chatbotId,
          conversationId,
          customerMessage: payload.content,
          callbacks: {
            onStarted: (streamId) => this.realtime.emitToConversation(conversationId, "ai:started", { conversationId, streamId }),
            onChunk: (streamId, index, delta) => this.realtime.emitToConversation(conversationId, "ai:chunk", { conversationId, streamId, index, delta }),
            onCompleted: (msg) => this.realtime.emitToConversation(conversationId, "ai:completed", { conversationId, message: toMessageDto(msg) }),
            onFailed: (streamId, msg, errorMessage) =>
              this.realtime.emitToConversation(conversationId, "ai:failed", {
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
