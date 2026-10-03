"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { AckResult, AiFailedPayload, ApiError, ConversationDto, MessageDto, WidgetSendMessageResult } from "@helpflow/types";

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
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const visitorTokenRef = useRef<string | null>(null);
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
      visitorTokenRef.current = data.visitorToken;
      setConversation(data.conversation);
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
      socket.on("ai:failed", (payload: AiFailedPayload) => {
        setStreaming(null);
        const partial = payload.message;
        if (partial) setMessages((prev) => (prev.some((m) => m.id === partial.id) ? prev : [...prev, partial]));
        // INTERRUPTED = the customer asked for a human mid-answer (T2) — expected, not an error.
        if (partial?.streamStatus !== "INTERRUPTED") setError("The assistant could not answer that. Please try again.");
      });
      socket.on("conversation:updated", (updated: ConversationDto) => {
        setConversation((prev) => (!prev || prev.id === updated.id ? updated : prev));
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
    socket.emit("message:send", { clientMessageId: crypto.randomUUID(), content }, (ack: AckResult<WidgetSendMessageResult>) => {
      if (!ack.ok) {
        setError(ack.error.message);
        return;
      }
      // A message after CLOSED lazily opens a new conversation — track it so handoff targets the new one.
      setConversation(ack.data.conversation);
      setContactSent(false);
    });
  }

  async function postVisitor(path: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: ApiError | null }> {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Visitor-Token": visitorTokenRef.current ?? "" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
    return res.ok ? { ok: true, data: payload } : { ok: false, error: payload as ApiError | null };
  }

  async function requestHuman() {
    if (!conversation) return;
    setError(null);
    setHandoffPending(true);
    try {
      const result = await postVisitor(`/api/widget/conversations/${conversation.id}/handoff`);
      if (result.ok) {
        setConversation((prev) => (prev ? { ...prev, status: "WAITING_AGENT" } : prev));
      } else {
        const current = result.error?.details?.currentState as ConversationDto | undefined;
        if (current) setConversation(current);
        setError(result.error?.message ?? "Could not reach a human right now. Please try again.");
      }
    } catch {
      setError("Could not reach a human right now. Please try again.");
    } finally {
      setHandoffPending(false);
    }
  }

  async function sendContact() {
    const email = contactEmail.trim();
    if (!conversation || !email) return;
    setError(null);
    try {
      const result = await postVisitor(`/api/widget/conversations/${conversation.id}/contact`, { email });
      if (result.ok) setContactSent(true);
      else setError(result.error?.message ?? "Could not save your email. Please try again.");
    } catch {
      setError("Could not save your email. Please try again.");
    }
  }

  const status = conversation?.status;
  const canRequestHuman = status === "AI_ACTIVE";
  const lastMessage = messages[messages.length - 1];
  const showInlineHandoff = canRequestHuman && !streaming && lastMessage?.senderType === "AI" && lastMessage.insufficientKnowledge === true;
  const askForEmail = status === "CLOSED" && conversation?.closeReason === "AGENT_UNAVAILABLE" && !contactSent;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>{botName}</span>
        {canRequestHuman && (
          <button style={styles.headerButton} disabled={handoffPending} onClick={requestHuman}>
            {handoffPending ? "Connecting…" : "Talk to a human"}
          </button>
        )}
      </div>
      {status === "WAITING_AGENT" && <div style={styles.statusBar}>Waiting for a support agent to join…</div>}
      {status === "AGENT_ACTIVE" && <div style={styles.statusBar}>You&apos;re now chatting with a support agent.</div>}
      {status === "CLOSED" && !askForEmail && (
        <div style={styles.statusBar}>This conversation has ended. Send a message to start a new one.</div>
      )}
      <div ref={scrollRef} style={styles.messages}>
        {welcomeMessage && messages.length === 0 && <div style={styles.bubbleAi}>{welcomeMessage}</div>}
        {messages.map((m) =>
          m.senderType === "SYSTEM" ? (
            <div key={m.id} style={styles.system}>
              {m.content}
            </div>
          ) : (
            <div key={m.id} style={m.senderType === "CUSTOMER" ? styles.bubbleCustomer : styles.bubbleAi}>
              {m.senderType === "AGENT" && <div style={styles.senderLabel}>Support agent</div>}
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
          ),
        )}
        {streaming && <div style={styles.bubbleAi}>{streaming.text || "…"}</div>}
        {showInlineHandoff && (
          <button style={styles.inlineButton} disabled={handoffPending} onClick={requestHuman}>
            Yes, talk to a human
          </button>
        )}
        {askForEmail && (
          <div style={styles.contactCard}>
            <div>No agent is available right now. Leave your email and we&apos;ll get back to you.</div>
            <div style={styles.contactRow}>
              <input
                style={styles.input}
                type="email"
                placeholder="you@example.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendContact();
                }}
              />
              <button style={styles.sendButton} disabled={!contactEmail.trim()} onClick={() => void sendContact()}>
                Send
              </button>
            </div>
          </div>
        )}
        {status === "CLOSED" && contactSent && <div style={styles.system}>Thanks! We&apos;ll contact you by email.</div>}
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
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid #e5e7eb" },
  headerButton: { padding: "4px 10px", borderRadius: 999, border: "1px solid #d1d5db", background: "white", fontSize: 12, cursor: "pointer" },
  statusBar: { padding: "6px 16px", fontSize: 12, background: "#eff6ff", color: "#1e40af", borderBottom: "1px solid #dbeafe" },
  system: { alignSelf: "center", fontSize: 12, color: "#6b7280", textAlign: "center", padding: "2px 8px" },
  senderLabel: { fontSize: 11, fontWeight: 600, opacity: 0.7, marginBottom: 2 },
  inlineButton: { alignSelf: "flex-start", padding: "6px 12px", borderRadius: 999, border: "1px solid #2563eb", background: "white", color: "#2563eb", fontSize: 13, cursor: "pointer" },
  contactCard: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  contactRow: { display: "flex", gap: 8 },
  messages: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  bubbleCustomer: { alignSelf: "flex-end", background: "#2563eb", color: "white", padding: "8px 12px", borderRadius: 12, maxWidth: "80%" },
  bubbleAi: { alignSelf: "flex-start", background: "#f3f4f6", color: "#111827", padding: "8px 12px", borderRadius: 12, maxWidth: "80%" },
  citations: { marginTop: 6, fontSize: 11, opacity: 0.7, display: "flex", flexDirection: "column", gap: 2 },
  error: { color: "#dc2626", fontSize: 12, padding: "4px 8px" },
  inputRow: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid #e5e7eb" },
  input: { flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db" },
  sendButton: { padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "white", cursor: "pointer" },
};
