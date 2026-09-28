"use client";

import { createContext, useContext, useMemo } from "react";
import type { Socket } from "socket.io-client";
import type { Ack, AgentSendMessagePayload, MessageDto } from "@helpflow/types";
import { useAgentSocket } from "@/hooks/use-agent-socket";

interface AgentSocketContextValue {
  socket: React.RefObject<Socket | null>;
  sendMessage: (payload: AgentSendMessagePayload) => Promise<MessageDto | null>;
}

const AgentSocketContext = createContext<AgentSocketContextValue | null>(null);

export function AgentSocketProvider({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const socket = useAgentSocket(orgId);

  const value = useMemo<AgentSocketContextValue>(
    () => ({
      socket,
      sendMessage: (payload) =>
        new Promise((resolve) => {
          if (!socket.current) return resolve(null);
          socket.current.emit("message:send", payload, ((result) => {
            resolve(result.ok ? result.data : null);
          }) as Ack<MessageDto>);
        }),
    }),
    [socket],
  );

  return <AgentSocketContext.Provider value={value}>{children}</AgentSocketContext.Provider>;
}

export function useAgentSocketContext(): AgentSocketContextValue {
  const ctx = useContext(AgentSocketContext);
  if (!ctx) throw new Error("useAgentSocketContext must be used within AgentSocketProvider");
  return ctx;
}
