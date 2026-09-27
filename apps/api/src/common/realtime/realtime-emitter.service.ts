// Socket.IO namespaces are isolated by design, but Section 7's rooms (conversation:{id},
// org:{orgId}:inbox) are meant to reach BOTH the customer (/widget) and watching staff (/agent).
// The two gateways register their namespace server here at startup; every server push goes through
// this single service instead of each gateway emitting only into its own namespace.
import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";
import type { ServerToClientEvents } from "@helpflow/types";

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function inboxRoom(organizationId: string): string {
  return `org:${organizationId}:inbox`;
}

@Injectable()
export class RealtimeEmitterService {
  private widgetServer?: Server;
  private agentServer?: Server;

  registerWidgetServer(server: Server): void {
    this.widgetServer = server;
  }

  registerAgentServer(server: Server): void {
    this.agentServer = server;
  }

  emitToConversation<E extends keyof ServerToClientEvents>(conversationId: string, event: E, payload: Parameters<ServerToClientEvents[E]>[0]): void {
    const room = conversationRoom(conversationId);
    this.widgetServer?.to(room).emit(event, payload as never);
    this.agentServer?.to(room).emit(event, payload as never);
  }

  emitInboxUpdated(organizationId: string, payload: Parameters<ServerToClientEvents["inbox:updated"]>[0]): void {
    this.agentServer?.to(inboxRoom(organizationId)).emit("inbox:updated", payload);
  }
}

export { conversationRoom, inboxRoom };
