"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DEFAULTS } from "@helpflow/config/defaults";
import {
  ApiErrorCode,
  t,
  type AckResult,
  type AiFailedPayload,
  type ApiError,
  type ConversationDto,
  type I18nKey,
  type Language,
  type MessageDto,
  type MessageSenderType,
  type WidgetSendMessagePayload,
  type WidgetSendMessageResult,
} from "@helpflow/types";
import styles from "./chat-widget.module.css";
import { ArrowDownIcon, BotIcon, ChevronDownIcon, EndChatIcon, HeadsetIcon, MoreIcon, SendIcon } from "./icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const VISITOR_STORAGE_KEY = "hf_visitor";
// Tells apps/widget/public/loader.js to grow/shrink the iframe. Carries no data beyond open/closed.
const LOADER_MESSAGE_TYPE = "helpflow:widget";
const HOST_MESSAGE_TYPE = "helpflow:host";
// Phone-sized → full-screen panel. Embedded, the loader decides (it sees the host viewport); keep in sync with loader.js.
const COMPACT_MAX_WIDTH = 480;
// Pixels from the bottom that still count as "reading the latest message" for auto-scroll.
const STICK_TO_BOTTOM_PX = 64;
// Failsafe only: the server bounds a reply with these timeouts and normally sends ai:failed itself. If
// nothing at all arrives for this long, stop the typing indicator and offer Retry. Never delays a reply.
const REPLY_WATCHDOG_MS = DEFAULTS.llm.requestTimeoutMs + DEFAULTS.llm.firstTokenTimeoutMs;
// Not worth a retry button: the same request would fail the same way.
const NON_RETRYABLE: ReadonlySet<string> = new Set([
  ApiErrorCode.QUOTA_EXCEEDED,
  ApiErrorCode.DAILY_CAP_EXCEEDED,
  ApiErrorCode.RESOURCE_DISABLED,
  ApiErrorCode.VALIDATION_ERROR,
]);

interface SessionResponse {
  visitorToken: string;
  config: { name: string; welcomeMessage: string | null; defaultLanguage: Language };
  conversation: ConversationDto | null;
  messages: MessageDto[];
}

/** A customer message shown optimistically until the server acks it (or failed, with Retry). */
interface PendingSend {
  clientMessageId: string;
  content: string;
  status: "sending" | "failed";
}

type SessionPhase = "loading" | "ready" | "error";

const WIDGET_ERROR_KEYS = new Set<I18nKey>(["connectFailed", "answerFailed", "handoffFailed", "emailFailed", "quotaReached", "endChatFailed"]);
function isI18nKey(value: string): value is I18nKey {
  return WIDGET_ERROR_KEYS.has(value as I18nKey);
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

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent access throws — we're in an iframe
  }
}

export function ChatWidget({ chatbotId }: { chatbotId: string }) {
  const [botName, setBotName] = useState<string>("");
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [defaultLanguage, setDefaultLanguage] = useState<Language>("vi");
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [pending, setPending] = useState<PendingSend[]>([]);
  // A reply is being generated (between ai:started and ai:completed/failed). Its chunks are NOT shown:
  // they include the model's raw JSON trailer, so the widget keeps the typing dots until the final,
  // server-parsed message arrives.
  const [streaming, setStreaming] = useState<{ streamId: string } | null>(null);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [replyError, setReplyError] = useState<{ key: I18nKey; retryable: boolean } | null>(null);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [compact, setCompact] = useState(false);
  const [peek, setPeek] = useState(false); // launcher hovered / focused while closed → show who you'd chat with
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const visitorTokenRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastSentRef = useRef<WidgetSendMessagePayload | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Messages that must not play the entrance animation: history loaded at startup, and whatever was
  // on screen when the panel was minimized.
  const noEnterIdsRef = useRef<Set<string>>(new Set());
  // AI answers that replace the typing dots: the label stays put and only the bubble fades in.
  const revealIdsRef = useRef<Set<string>>(new Set());

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      setAwaitingReply(false);
      setStreaming(null);
      setReplyError({ key: "answerFailed", retryable: true });
    }, REPLY_WATCHDOG_MS);
  }, [clearWatchdog]);

  // ───────────── Session + socket ─────────────
  useEffect(() => {
    let cancelled = false;
    setPhase("loading");

    async function bootstrap() {
      let data: SessionResponse;
      try {
        const res = await fetch(`${API_URL}/api/widget/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatbotId, visitorToken: readStoredToken() ?? undefined }),
        });
        if (!res.ok) throw new Error(`session ${res.status}`);
        data = (await res.json()) as SessionResponse;
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      if (cancelled) return;

      storeToken(data.visitorToken);
      visitorTokenRef.current = data.visitorToken;
      noEnterIdsRef.current = new Set(data.messages.map((m) => m.id));
      stickToBottomRef.current = true;
      setConversation(data.conversation);
      setBotName(data.config.name);
      setWelcomeMessage(data.config.welcomeMessage);
      setDefaultLanguage(data.config.defaultLanguage);
      setMessages(data.messages);
      setPhase("ready");

      const socket = io(`${API_URL}/widget`, { auth: { visitorToken: data.visitorToken }, transports: ["websocket"] });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        setConnectionLost(false);
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => {
        setConnected(false);
        setConnectionLost(true);
      });

      socket.on("message:created", (message: MessageDto) => {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      });
      socket.on("ai:started", (payload: { streamId: string }) => {
        armWatchdog();
        setAwaitingReply(false);
        setStreaming({ streamId: payload.streamId });
      });
      socket.on("ai:chunk", () => {
        armWatchdog(); // still generating — keep the dots, just push the failsafe back
      });
      socket.on("ai:completed", (payload: { message: MessageDto }) => {
        clearWatchdog();
        revealIdsRef.current.add(payload.message.id); // replaces the typing dots in place
        setAwaitingReply(false);
        setStreaming(null);
        setMessages((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
      });
      socket.on("ai:failed", (payload: AiFailedPayload) => {
        clearWatchdog();
        setAwaitingReply(false);
        setStreaming(null);
        const partial = payload.message;
        if (partial) {
          revealIdsRef.current.add(partial.id);
          setMessages((prev) => (prev.some((m) => m.id === partial.id) ? prev : [...prev, partial]));
        }
        // INTERRUPTED = the customer asked for a human mid-answer (T2) — expected, not an error.
        if (partial?.streamStatus === "INTERRUPTED") return;
        const quota = payload.error.code === ApiErrorCode.QUOTA_EXCEEDED || payload.error.code === ApiErrorCode.DAILY_CAP_EXCEEDED;
        setReplyError({ key: quota ? "quotaReached" : "answerFailed", retryable: !NON_RETRYABLE.has(payload.error.code) });
      });
      socket.on("conversation:updated", (updated: ConversationDto) => {
        setConversation((prev) => (!prev || prev.id === updated.id ? updated : prev));
        if (updated.status !== "AI_ACTIVE") setAwaitingReply(false);
      });
    }

    void bootstrap();
    return () => {
      cancelled = true;
      clearWatchdog();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [chatbotId, sessionAttempt, armWatchdog, clearWatchdog]);

  // ───────────── Open / close ─────────────
  useEffect(() => {
    // Opened by default on the bare /c/:id page (preview / direct link); collapsed to the launcher when embedded.
    if (!isEmbedded()) setOpen(true);
  }, []);

  useEffect(() => {
    if (!isEmbedded()) return;
    // The payload is just a boolean, so the parent's origin needn't be known; loader.js checks ours.
    window.parent.postMessage({ type: LOADER_MESSAGE_TYPE, open: open || closing, peek: peek && !open }, "*");
  }, [open, closing, peek]);

  useEffect(() => {
    if (isEmbedded()) {
      const onMessage = (e: MessageEvent) => {
        if (e.source === window.parent && e.data?.type === HOST_MESSAGE_TYPE) setCompact(e.data.compact === true);
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }
    const query = window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const finishClose = useCallback(() => {
    setClosing(false);
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  useEffect(() => {
    // Whatever was on screen when the panel closed must not replay its entrance when it reopens.
    if (!open) for (const m of messages) noEnterIdsRef.current.add(m.id);
  }, [open, messages]);

  const closePanel = useCallback(() => {
    if (prefersReducedMotion()) finishClose();
    else setClosing(true); // finishClose runs on the exit animation's end
  }, [finishClose]);

  function togglePanel() {
    if (open && !closing) closePanel();
    else {
      setPeek(false);
      stickToBottomRef.current = true;
      setAtBottom(true);
      setClosing(false);
      setOpen(true);
    }
  }

  useEffect(() => {
    if (!open || closing) return;
    stickToBottomRef.current = true;
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Innermost layer first: the confirm dialog, then the menu, then the panel itself.
      if (confirmEnd) setConfirmEnd(false);
      else if (menuOpen) setMenuOpen(false);
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closing, closePanel, confirmEnd, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-hf-menu]")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  // ───────────── Auto-scroll ─────────────
  // Follow new content only while the reader is at the bottom; if they scrolled up to read, leave
  // them there and offer a "jump to latest" pill. Runs before paint, so streaming never jitters.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, streaming, awaitingReply, replyError, error, phase, open, conversation?.status]);

  function onMessagesScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX;
    stickToBottomRef.current = bottom;
    setAtBottom((prev) => (prev === bottom ? prev : bottom));
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  // ───────────── Sending ─────────────
  function emit(payload: WidgetSendMessagePayload) {
    const socket = socketRef.current;
    if (!socket) return;
    lastSentRef.current = payload;
    stickToBottomRef.current = true;
    setReplyError(null);
    setError(null);
    // The AI answers only in AI_ACTIVE (or a fresh conversation after CLOSED); otherwise an agent does.
    const expectsAi = !conversation || conversation.status === "AI_ACTIVE" || conversation.status === "CLOSED";
    if (expectsAi) {
      setAwaitingReply(true);
      armWatchdog();
    }
    socket.emit("message:send", payload, (ack: AckResult<WidgetSendMessageResult>) => {
      if (!ack.ok) {
        clearWatchdog();
        setAwaitingReply(false);
        if (ack.error.code === ApiErrorCode.QUOTA_EXCEEDED) setReplyError({ key: "quotaReached", retryable: false });
        setPending((prev) => prev.map((p) => (p.clientMessageId === payload.clientMessageId ? { ...p, status: "failed" } : p)));
        return;
      }
      setPending((prev) => prev.filter((p) => p.clientMessageId !== payload.clientMessageId));
      setMessages((prev) => (prev.some((m) => m.id === ack.data.message.id) ? prev : [...prev, ack.data.message]));
      // A message after CLOSED lazily opens a new conversation — track it so handoff targets the new one.
      setConversation(ack.data.conversation);
      setContactSent(false);
      // Handoff via chat ("talk to a human", or "yes" to the offer) — no AI reply follows.
      if (ack.data.conversation.status !== "AI_ACTIVE") {
        clearWatchdog();
        setAwaitingReply(false);
      }
    });
  }

  function send() {
    const content = input.trim();
    if (!content || !canSend) return;
    const payload = { clientMessageId: crypto.randomUUID(), content };
    setInput("");
    setPending((prev) => [...prev, { ...payload, status: "sending" }]);
    emit(payload);
  }

  function retrySend(item: PendingSend) {
    setPending((prev) => prev.map((p) => (p.clientMessageId === item.clientMessageId ? { ...p, status: "sending" } : p)));
    emit({ clientMessageId: item.clientMessageId, content: item.content }); // same id → idempotent on the server
  }

  function retryReply() {
    // Re-sending the same clientMessageId never duplicates the customer message (Section 7 "Duplicate sends").
    if (lastSentRef.current) emit(lastSentRef.current);
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
        setError(result.error?.message ?? "handoffFailed");
      }
    } catch {
      setError("handoffFailed");
    } finally {
      setHandoffPending(false);
    }
  }

  /** T10: the customer ends the conversation (after confirming). */
  async function endConversation() {
    if (!conversation) return;
    setError(null);
    setEnding(true);
    try {
      const result = await postVisitor(`/api/widget/conversations/${conversation.id}/close`);
      if (result.ok) {
        setConversation(result.data as ConversationDto);
      } else {
        // Already closed / changed meanwhile (e.g. the agent closed it first): show the current state.
        const current = result.error?.details?.currentState as ConversationDto | undefined;
        if (current) setConversation(current);
        else setError("endChatFailed");
      }
      clearWatchdog();
      setAwaitingReply(false);
      setStreaming(null);
      setReplyError(null);
    } catch {
      setError("endChatFailed");
    } finally {
      setEnding(false);
      setConfirmEnd(false);
    }
  }

  /** Clears the ended conversation from view; the next message lazily opens a new one (T1). */
  function startNewConversation() {
    setMessages([]);
    setPending([]);
    setReplyError(null);
    setError(null);
    setContactSent(false);
    setConversation(null);
    stickToBottomRef.current = true;
    inputRef.current?.focus();
  }

  async function sendContact() {
    const email = contactEmail.trim();
    if (!conversation || !email) return;
    setError(null);
    try {
      const result = await postVisitor(`/api/widget/conversations/${conversation.id}/contact`, { email });
      if (result.ok) setContactSent(true);
      else setError(result.error?.message ?? "emailFailed");
    } catch {
      setError("emailFailed");
    }
  }

  // Section 5 "Language": widget chrome follows the session language (chatbot default before T1).
  const language = conversation?.language ?? defaultLanguage;
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const errorText = error && isI18nKey(error) ? t(language, error) : error;
  const status = conversation?.status;
  const canRequestHuman = status === "AI_ACTIVE";
  const aiBusy = streaming !== null || awaitingReply;
  const canSend = phase === "ready" && connected && !aiBusy;
  const lastMessage = messages[messages.length - 1];
  const showInlineHandoff = canRequestHuman && !aiBusy && lastMessage?.senderType === "AI" && lastMessage.insufficientKnowledge === true;
  const askForEmail = status === "CLOSED" && conversation?.closeReason === "AGENT_UNAVAILABLE" && !contactSent;
  const deliveredIds = new Set(messages.map((m) => m.clientMessageId).filter(Boolean));
  const visiblePending = pending.filter((p) => !deliveredIds.has(p.clientMessageId));
  const panelVisible = open || closing;

  // Who is answering: a small label opens every run of AI / agent replies (a SYSTEM message, e.g.
  // "an agent joined", starts a new run), so scrolling back still shows who said what.
  const senderLabel = (sender: "AI" | "AGENT") => (
    <div className={`${styles.senderLabel} ${sender === "AGENT" ? styles.senderLabelAgent : ""}`}>
      {sender === "AGENT" ? <HeadsetIcon /> : <BotIcon size={12} />}
      {t(language, sender === "AGENT" ? "supportAgent" : "aiAssistant")}
    </div>
  );
  let previousSender: MessageSenderType | null = welcomeMessage ? "AI" : null;

  // One keyed list for persisted + optimistic messages: a customer message is keyed by its
  // clientMessageId in both states, so the optimistic bubble becomes the persisted one in place.
  const timeline = [
    ...messages.map((m) => {
      const startsRun = m.senderType !== previousSender;
      previousSender = m.senderType;
      if (m.senderType === "SYSTEM") {
        return (
          <div key={m.id} className={`${styles.system} ${noEnterIdsRef.current.has(m.id) ? "" : styles.enter}`}>
            {m.content}
          </div>
        );
      }
      if (m.senderType === "CUSTOMER") {
        const optimisticTwin = Boolean(m.clientMessageId);
        const animate = !optimisticTwin && !noEnterIdsRef.current.has(m.id);
        return (
          <div key={m.clientMessageId ?? m.id} className={`${styles.bubble} ${styles.bubbleCustomer} ${animate ? styles.enter : ""}`}>
            {m.content}
          </div>
        );
      }
      const noEnter = noEnterIdsRef.current.has(m.id);
      const reveal = !noEnter && revealIdsRef.current.has(m.id);
      return (
        <div key={m.id} className={`${styles.turn} ${noEnter || reveal ? "" : styles.enter}`}>
          {startsRun && senderLabel(m.senderType)}
          <div className={`${styles.bubble} ${styles.bubbleAi} ${reveal ? styles.reveal : ""}`}>
            {m.content}
            {m.citations && m.citations.length > 0 && (
              <div className={styles.citations}>
                {m.citations.map((c) => (
                  <span key={c.index}>
                    [{c.index}] {c.documentName}
                    {c.pageNumber ? ` ${t(language, "page")}${c.pageNumber}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }),
    ...visiblePending.flatMap((p) => [
      <div
        key={p.clientMessageId}
        className={`${styles.bubble} ${styles.bubbleCustomer} ${styles.enter} ${p.status === "failed" ? styles.bubbleFailed : styles.bubblePending}`}
      >
        {p.content}
      </div>,
      p.status === "failed" ? (
        <div key={`${p.clientMessageId}-failed`} className={styles.failedRow}>
          {t(language, "sendFailed")}
          <button className={styles.retryButton} onClick={() => retrySend(p)}>
            {t(language, "retry")}
          </button>
        </div>
      ) : null,
    ]),
  ];
  const aiSlotStartsRun = visiblePending.length > 0 || previousSender !== "AI";
  const who = status === "AGENT_ACTIVE" ? "agent" : status === "WAITING_AGENT" ? "waiting" : "ai";

  return (
    <div className={styles.root}>
      {panelVisible && (
        <section
          className={`${styles.panel} ${compact ? styles.panelCompact : ""} ${closing ? styles.panelClosing : ""}`}
          aria-label={botName}
          onAnimationEnd={(e) => {
            if (closing && e.target === e.currentTarget) finishClose();
          }}
        >
          <header className={styles.header}>
            <div className={styles.avatar} aria-hidden>
              {botName.trim().charAt(0).toUpperCase()}
            </div>
            <div className={styles.headerText}>
              {botName ? <div className={styles.title}>{botName}</div> : <div className={`${styles.skeleton} ${styles.titleSkeleton}`} />}
              <div className={`${styles.subtitle} ${who === "agent" ? styles.subtitleAgent : ""}`} aria-live="polite">
                {who === "ai" ? <BotIcon size={13} /> : <HeadsetIcon size={13} />}
                {t(language, who === "agent" ? "supportAgent" : who === "waiting" ? "waitingForAgentShort" : "aiAssistant")}
              </div>
            </div>
            {canRequestHuman && (
              <button className={styles.chipButton} disabled={handoffPending} onClick={requestHuman}>
                {handoffPending ? t(language, "connecting") : t(language, "talkToHuman")}
              </button>
            )}
            {conversation && status !== "CLOSED" && (
              <div className={styles.menuAnchor} data-hf-menu>
                <button
                  className={`${styles.iconButton} ${styles.moreButton}`}
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label={t(language, "moreOptions")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <MoreIcon />
                </button>
                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    <button
                      className={`${styles.menuItem} ${styles.menuItemDanger}`}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmEnd(true);
                      }}
                    >
                      <EndChatIcon />
                      {t(language, "endChat")}
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Minimize, not end: the conversation stays open and resumes when reopened. */}
            <button className={`${styles.iconButton} ${styles.minimizeButton}`} onClick={closePanel} aria-label={t(language, "minimize")} title={t(language, "minimize")}>
              <ChevronDownIcon />
            </button>
          </header>

          {phase === "ready" && connectionLost && <div className={`${styles.statusBar} ${styles.statusBarError}`}>{t(language, "reconnecting")}</div>}
          {status === "WAITING_AGENT" && <div className={styles.statusBar}>{t(language, "waitingForAgent")}</div>}
          {status === "AGENT_ACTIVE" && <div className={styles.statusBar}>{t(language, "chattingWithAgent")}</div>}
          {status === "CLOSED" && !askForEmail && (
            <div className={styles.statusBar}>
              {t(language, conversation?.closeReason === "CLOSED_BY_CUSTOMER" ? "conversationEndedByYou" : "conversationEnded")}
            </div>
          )}

          <div className={styles.messagesWrap}>
            <div ref={scrollRef} className={styles.messages} onScroll={onMessagesScroll} aria-live="polite" aria-busy={aiBusy}>
              {phase === "loading" && (
                <>
                  <div className={`${styles.skeleton}`} style={{ width: "62%" }} />
                  <div className={`${styles.skeleton}`} style={{ width: "44%", alignSelf: "flex-end" }} />
                  <div className={`${styles.skeleton}`} style={{ width: "70%", height: 52 }} />
                </>
              )}

              {phase === "error" && (
                <div className={styles.loadError}>
                  <div>{t(language, "loadFailed")}</div>
                  <button className={styles.retryButton} onClick={() => setSessionAttempt((n) => n + 1)}>
                    {t(language, "retry")}
                  </button>
                </div>
              )}

              {phase === "ready" && (
                <>
                  {welcomeMessage && (
                    <div className={styles.turn}>
                      {senderLabel("AI")}
                      <div className={`${styles.bubble} ${styles.bubbleAi}`}>{welcomeMessage}</div>
                    </div>
                  )}
                  {timeline}

                  {aiBusy && (
                    // Typing dots until the complete answer arrives (then the message above replaces this slot).
                    <div key="ai-slot" className={`${styles.turn} ${styles.enter}`}>
                      {aiSlotStartsRun && senderLabel("AI")}
                      <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                        <span className={styles.typing} role="status" aria-label={t(language, "assistantTyping")}>
                          <span />
                          <span />
                          <span />
                        </span>
                      </div>
                    </div>
                  )}

                  {showInlineHandoff && (
                    <button className={`${styles.inlineButton} ${styles.enter}`} disabled={handoffPending} onClick={requestHuman}>
                      {t(language, "yesTalkToHuman")}
                    </button>
                  )}

                  {replyError && (
                    <div className={`${styles.inlineError} ${styles.enter}`} role="alert">
                      <span>{t(language, replyError.key)}</span>
                      {replyError.retryable && (
                        <button className={styles.retryButton} onClick={retryReply} disabled={!connected}>
                          {t(language, "retry")}
                        </button>
                      )}
                    </div>
                  )}

                  {askForEmail && (
                    <div className={`${styles.contactCard} ${styles.enter}`}>
                      <div>{t(language, "leaveEmail")}</div>
                      <div className={styles.contactRow}>
                        <input
                          className={styles.input}
                          type="email"
                          placeholder="you@example.com"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void sendContact();
                          }}
                        />
                        <button className={styles.sendButton} disabled={!contactEmail.trim()} onClick={() => void sendContact()} aria-label={t(language, "send")}>
                          <SendIcon />
                        </button>
                      </div>
                    </div>
                  )}
                  {status === "CLOSED" && contactSent && <div className={`${styles.system} ${styles.enter}`}>{t(language, "emailThanks")}</div>}
                  {status === "CLOSED" && !askForEmail && (
                    <button className={`${styles.inlineButton} ${styles.startNewButton} ${styles.enter}`} onClick={startNewConversation}>
                      {t(language, "startNewChat")}
                    </button>
                  )}
                  {errorText && (
                    <div className={`${styles.inlineError} ${styles.enter}`} role="alert">
                      <span>{errorText}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            {!atBottom && phase === "ready" && (
              <button className={styles.jumpButton} onClick={jumpToLatest}>
                <ArrowDownIcon /> {t(language, "jumpToLatest")}
              </button>
            )}
          </div>

          <div className={styles.composer}>
            <input
              ref={inputRef}
              className={styles.input}
              value={input}
              disabled={phase !== "ready"}
              maxLength={DEFAULTS.socket.maxMessageChars}
              placeholder={phase === "ready" && connected ? t(language, "askPlaceholder") : t(language, "connecting")}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
              }}
            />
            <button className={styles.sendButton} disabled={!canSend || !input.trim()} onClick={send} aria-label={t(language, "send")}>
              <SendIcon />
            </button>
          </div>
          {confirmEnd && (
            <div className={styles.overlay} onClick={() => !ending && setConfirmEnd(false)}>
              <div
                className={styles.dialog}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="hf-end-title"
                aria-describedby="hf-end-body"
                onClick={(e) => e.stopPropagation()}
              >
                <div id="hf-end-title" className={styles.dialogTitle}>
                  {t(language, "endChatConfirmTitle")}
                </div>
                <div id="hf-end-body" className={styles.dialogBody}>
                  {t(language, "endChatConfirmBody")}
                </div>
                <div className={styles.dialogActions}>
                  <button className={styles.secondaryButton} onClick={() => setConfirmEnd(false)} disabled={ending} autoFocus>
                    {t(language, "cancel")}
                  </button>
                  <button className={styles.dangerButton} onClick={() => void endConversation()} disabled={ending}>
                    {t(language, "endChatConfirm")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <div
        className={styles.launcherGroup}
        onPointerEnter={(e) => e.pointerType === "mouse" && setPeek(true)}
        onPointerLeave={() => setPeek(false)}
      >
        {peek && !panelVisible && botName && (
          <div className={styles.launcherLabel} onClick={togglePanel} aria-hidden>
            <div className={styles.launcherLabelTitle}>{t(language, "chatWith").replace("{name}", botName)}</div>
            <div className={styles.launcherLabelHint}>{t(language, "launcherHint")}</div>
          </div>
        )}
        <button
          ref={launcherRef}
          className={styles.launcher}
          onClick={togglePanel}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && setPeek(true)}
          onBlur={() => setPeek(false)}
          aria-label={
            panelVisible && !closing ? t(language, "closeChat") : botName ? t(language, "chatWith").replace("{name}", botName) : t(language, "openChat")
          }
          aria-expanded={panelVisible && !closing}
        >
          <span className={`${styles.launcherIcon} ${panelVisible && !closing ? styles.launcherIconHidden : ""}`}>
            <BotIcon />
          </span>
          <span className={`${styles.launcherIcon} ${panelVisible && !closing ? "" : styles.launcherIconHidden}`}>
            <ChevronDownIcon size={24} />
          </span>
        </button>
      </div>
    </div>
  );
}
