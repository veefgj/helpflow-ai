// The worker has no Socket.IO server of its own, but T4/T5/T6 timers (Section 7) fire here and
// must still reach connected clients. @socket.io/redis-emitter publishes into the same Redis-backed
// rooms apps/api's @socket.io/redis-adapter-enabled namespaces are subscribed to.
import { Emitter } from "@socket.io/redis-emitter";
import type { ConversationDto, InboxUpdatedPayload, MessageDto } from "@helpflow/types";
import { createRedisConnection } from "./redis";

const emitter = new Emitter(createRedisConnection());
const widget = emitter.of("/widget");
const agent = emitter.of("/agent");

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function inboxRoom(organizationId: string): string {
  return `org:${organizationId}:inbox`;
}

export function emitMessageCreated(conversationId: string, message: MessageDto): void {
  const room = conversationRoom(conversationId);
  widget.to(room).emit("message:created", message);
  agent.to(room).emit("message:created", message);
}

export function emitConversationUpdated(conversation: ConversationDto): void {
  const room = conversationRoom(conversation.id);
  widget.to(room).emit("conversation:updated", conversation);
  agent.to(room).emit("conversation:updated", conversation);
}

export function emitInboxUpdated(organizationId: string, payload: InboxUpdatedPayload): void {
  agent.to(inboxRoom(organizationId)).emit("inbox:updated", payload);
}
