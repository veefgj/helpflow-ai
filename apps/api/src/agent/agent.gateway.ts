// Section 7 "Transport rule" + socket-events.ts: namespace /agent (access JWT + organizationId).
// State-changing commands (accept, takeover, reassign, release, close) stay REST; this gateway only
// carries agent-side message:send and the read-only conversation:join/leave watch.
import { Inject, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { prisma, insertMessageSerialized } from "@helpflow/database";
import { loadEnv, DEFAULTS } from "@helpflow/config";
import { ApiErrorCode } from "@helpflow/types";
import type { AckResult, AgentJoinPayload, AgentSendMessagePayload, ConversationDto, MessageDto } from "@helpflow/types";
import { toConversationDto } from "../common/mappers/conversation.mapper";
import { toMessageDto } from "../common/mappers/message.mapper";
import { conversationRoom, inboxRoom, RealtimeEmitterService } from "../common/realtime/realtime-emitter.service";
import { ConversationTimersQueueService } from "../conversations/conversation-timers-queue.service";
import { AgentSocketTrackerService } from "./agent-socket-tracker.service";

interface AgentSocketData {
  userId: string;
  organizationId: string;
}

@WebSocketGateway({
  namespace: "/agent",
  cors: { origin: loadEnv().APP_URL, credentials: true },
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(AgentGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(AgentSocketTrackerService) private readonly tracker: AgentSocketTrackerService,
    @Inject(ConversationTimersQueueService) private readonly timers: ConversationTimersQueueService,
    @Inject(RealtimeEmitterService) private readonly realtime: RealtimeEmitterService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.registerAgentServer(server);
    // Namespace middleware runs BEFORE the client's own "connect" event fires and before any other
    // event it sends — unlike handleConnection (an async lifecycle hook that only starts after
    // "connect" already fired), so a client can never race ahead of client.data being populated.
    server.use(async (socket, next) => {
      const { accessToken, organizationId } = socket.handshake.auth as { accessToken?: string; organizationId?: string };
      if (!accessToken || !organizationId) {
        next(new Error("Missing accessToken or organizationId"));
        return;
      }

      let userId: string;
      try {
        userId = this.jwt.verify<{ sub: string }>(accessToken).sub;
      } catch {
        next(new Error("Invalid or expired access token"));
        return;
      }

      const membership = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
      if (!membership || membership.disabledReason) {
        next(new Error("Not an active member of this organization"));
        return;
      }

      socket.data = { userId, organizationId } satisfies AgentSocketData;
      next();
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const { userId, organizationId } = client.data as AgentSocketData;
    await client.join(inboxRoom(organizationId));
    await client.join(`user:${userId}`);

    const justCameOnline = await this.tracker.connect(userId);
    if (justCameOnline) {
      // Section 7 "Agent disconnect": reconnecting within the grace period keeps AGENT_ACTIVE.
      const assigned = await prisma.conversation.findMany({ where: { organizationId, assignedAgentId: userId, status: "AGENT_ACTIVE" } });
      await Promise.all(assigned.map((c) => this.timers.cancelAgentGrace(c.id)));
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const data = client.data as Partial<AgentSocketData>;
    if (!data.userId || !data.organizationId) return;

    const lastSocketClosed = await this.tracker.disconnect(data.userId);
    if (!lastSocketClosed) return;

    const assigned = await prisma.conversation.findMany({
      where: { organizationId: data.organizationId, assignedAgentId: data.userId, status: "AGENT_ACTIVE" },
    });
    await Promise.all(assigned.map((c) => this.timers.scheduleAgentGrace(c.id, DEFAULTS.handoff.agentDisconnectGraceSec)));
  }

  @SubscribeMessage("conversation:join")
  async handleJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: AgentJoinPayload): Promise<AckResult<ConversationDto>> {
    const data = client.data as AgentSocketData;
    const conversation = await prisma.conversation.findUnique({ where: { id: payload.conversationId } });
    if (!conversation || conversation.organizationId !== data.organizationId) {
      return { ok: false, error: { code: ApiErrorCode.RESOURCE_NOT_FOUND, message: "Conversation not found", requestId: "agent-socket" } };
    }
    await client.join(conversationRoom(conversation.id));
    return { ok: true, data: toConversationDto(conversation) };
  }

  @SubscribeMessage("conversation:leave")
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() payload: AgentJoinPayload): void {
    void client.leave(conversationRoom(payload.conversationId));
  }

  @SubscribeMessage("message:send")
  async handleMessageSend(@ConnectedSocket() client: Socket, @MessageBody() payload: AgentSendMessagePayload): Promise<AckResult<MessageDto>> {
    const data = client.data as AgentSocketData;
    const conversation = await prisma.conversation.findUnique({ where: { id: payload.conversationId } });
    if (!conversation || conversation.organizationId !== data.organizationId) {
      return { ok: false, error: { code: ApiErrorCode.RESOURCE_NOT_FOUND, message: "Conversation not found", requestId: "agent-socket" } };
    }
    if (conversation.status !== "AGENT_ACTIVE" || conversation.assignedAgentId !== data.userId) {
      return {
        ok: false,
        error: { code: ApiErrorCode.FORBIDDEN, message: "You may only reply to conversations assigned to you", requestId: "agent-socket" },
      };
    }
    if (!payload.content || payload.content.length > DEFAULTS.socket.maxMessageChars) {
      return {
        ok: false,
        error: { code: ApiErrorCode.VALIDATION_ERROR, message: `Message must be 1..${DEFAULTS.socket.maxMessageChars} characters`, requestId: "agent-socket" },
      };
    }

    const message = await insertMessageSerialized({
      organizationId: data.organizationId,
      conversationId: conversation.id,
      clientMessageId: payload.clientMessageId,
      senderType: "AGENT",
      senderId: data.userId,
      content: payload.content,
    });

    this.realtime.emitToConversation(conversation.id, "message:created", toMessageDto(message));
    return { ok: true, data: toMessageDto(message) };
  }
}
