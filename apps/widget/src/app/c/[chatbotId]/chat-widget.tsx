"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { AckResult, ConversationDto, MessageDto, WidgetSendMessageResult } from "@helpflow/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const VISITOR_STORAGE_KEY = "hf_visitor";

interface SessionResponse {
  visitorToken: string;
  config: { name: string; welcomeMessage: string | null };
  conversation: ConversationDto | null;
  messages: MessageDto[];
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(VISITOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(VISITOR_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable (private browsing etc.) — session just won't persist across reloads.
  }
}

export function ChatWidget({ chatbotId }: { chatbotId: string }) {
  const [botName, setBotName] = useState<string>("Support");
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [streaming, setStreaming] = useState<{ streamId: string; text: string } | null>(null);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const res = await fetch(`${API_URL}/api/widget/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, visitorToken: readStoredToken() ?? undefined }),
      });
      if (!res.ok || cancelled) return;
      const data: SessionResponse = await res.json();
      if (cancelled) return;

      storeToken(data.visitorToken);
      setBotName(data.config.name);
      setWelcomeMessage(data.config.welcomeMessage);
      setMessages(data.messages);

      const socket = io(`${API_URL}/widget`, { auth: { visitorToken: data.visitorToken }, transports: ["websocket"] });
      socketRef.current = socket;

      socket.on("connect", () => setReady(true));
      socket.on("connect_error", () => setError("Could not connect. Please retry."));

      socket.on("message:created", (message: MessageDto) => {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      });
      socket.on("ai:started", (payload: { streamId: string }) => {
        setStreaming({ streamId: payload.streamId, text: "" });
      });
      socket.on("ai:chunk", (payload: { streamId: string; delta: string }) => {
        setStreaming((prev) => (prev && prev.streamId === payload.streamId ? { ...prev, text: prev.text + payload.delta } : prev));
      });
      socket.on("ai:completed", (payload: { message: MessageDto }) => {
        setStreaming(null);
        setMessages((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
      });
      socket.on("ai:failed", () => {
        setStreaming(null);
        setError("The assistant could not answer that. Please try again.");
      });
    }

    void bootstrap();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, [chatbotId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  function send() {
    const content = input.trim();
    const socket = socketRef.current;
    if (!content || !socket) return;
    setError(null);
    setInput("");
    socket.emit(
      "message:send",
      { clientMessageId: crypto.randomUUID(), content },
      (ack: AckResult<WidgetSendMessageResult>) => {
        if (!ack.ok) setError(ack.error.message);
      },
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>{botName}</div>
      <div ref={scrollRef} style={styles.messages}>
        {welcomeMessage && messages.length === 0 && <div style={styles.bubbleAi}>{welcomeMessage}</div>}
        {messages.map((m) => (
          <div key={m.id} style={m.senderType === "CUSTOMER" ? styles.bubbleCustomer : styles.bubbleAi}>
            {m.content}
            {m.citations && m.citations.length > 0 && (
              <div style={styles.citations}>
                {m.citations.map((c) => (
                  <span key={c.index}>
                    [{c.index}] {c.documentName}
                    {c.pageNumber ? ` p.${c.pageNumber}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {streaming && <div style={styles.bubbleAi}>{streaming.text || "…"}</div>}
        {error && <div style={styles.error}>{error}</div>}
      </div>
      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={input}
          disabled={!ready || streaming !== null}
          placeholder={ready ? "Ask a question…" : "Connecting…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button style={styles.sendButton} disabled={!ready || streaming !== null || !input.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
  },
  header: { padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid #e5e7eb" },
  messages: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  bubbleCustomer: { alignSelf: "flex-end", background: "#2563eb", color: "white", padding: "8px 12px", borderRadius: 12, maxWidth: "80%" },
  bubbleAi: { alignSelf: "flex-start", background: "#f3f4f6", color: "#111827", padding: "8px 12px", borderRadius: 12, maxWidth: "80%" },
  citations: { marginTop: 6, fontSize: 11, opacity: 0.7, display: "flex", flexDirection: "column", gap: 2 },
  error: { color: "#dc2626", fontSize: 12, padding: "4px 8px" },
  inputRow: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid #e5e7eb" },
  input: { flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db" },
  sendButton: { padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "white", cursor: "pointer" },
};
