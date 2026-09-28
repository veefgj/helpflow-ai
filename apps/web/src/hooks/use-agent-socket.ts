"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationDto, InboxUpdatedPayload, MessageDto } from "@helpflow/types";
import { useAuthStore } from "@/lib/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** One /agent socket per org, shared for both the inbox list (inbox:updated) and whichever
 * conversation is currently open (message:created / conversation:updated / ai:completed). Mount
 * this once at the org layout level so the connection survives navigation between pages. */
export function useAgentSocket(orgId: string) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken || !orgId) return;

    const socket = io(`${API_URL}/agent`, { auth: { accessToken, organizationId: orgId }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("inbox:updated", (payload: InboxUpdatedPayload) => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "conversations"] });
      queryClient.setQueryData(["orgs", orgId, "conversations", payload.conversation.id], payload.conversation);
    });

    socket.on("conversation:updated", (conversation: ConversationDto) => {
      queryClient.setQueryData(["orgs", orgId, "conversations", conversation.id], conversation);
    });

    function appendMessage(conversationId: string, message: MessageDto) {
      queryClient.setQueryData<{ items: MessageDto[] }>(["orgs", orgId, "conversations", conversationId, "messages"], (prev) => {
        if (!prev) return { items: [message] };
        if (prev.items.some((m) => m.id === message.id)) return prev;
        return { items: [...prev.items, message] };
      });
    }

    socket.on("message:created", (message: MessageDto) => appendMessage(message.conversationId, message));
    socket.on("ai:completed", (payload: { conversationId: string; message: MessageDto }) => appendMessage(payload.conversationId, payload.message));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, orgId, queryClient]);

  return socketRef;
}

/** Watches a specific conversation (joins its room so message:created/ai:* for it actually arrive). */
export function useWatchConversation(socketRef: React.RefObject<Socket | null>, conversationId: string | undefined) {
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !conversationId) return;

    function join() {
      socket!.emit("conversation:join", { conversationId }, () => undefined);
    }
    if (socket.connected) join();
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
      socket.emit("conversation:leave", { conversationId });
    };
  }, [socketRef, conversationId]);
}
