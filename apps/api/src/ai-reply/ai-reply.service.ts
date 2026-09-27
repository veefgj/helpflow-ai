// Section 7 "AI reply pipeline" (steps 2-6; step 1, persisting the customer message, happens in
// the caller before this runs) + Section 5 retrieval/citation rules.
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { prisma, insertMessageSerialized, type Message } from "@helpflow/database";
import { DEFAULTS, resolve } from "@helpflow/config";
import { buildChatMessages, countTokens, getLlmProvider, parseTrailer, validateCitations, type ChatMessage, type HistoryMessage } from "@helpflow/ai";
import { ApiErrorCode } from "@helpflow/types";
import { AiGenLockService } from "./ai-gen-lock.service";
import { AiGenerationRegistry } from "./ai-generation-registry.service";
import { RetrievalService } from "./retrieval.service";
import { QuotaService } from "../quota/quota.service";

const INSUFFICIENT_KNOWLEDGE_FALLBACK =
  "I don't have information about that in what I've been given. Would you like to talk to a human?";

export interface AiReplyCallbacks {
  onStarted: (streamId: string) => void;
  onChunk: (streamId: string, index: number, delta: string) => void;
  onCompleted: (message: Message) => void;
  onFailed: (streamId: string, message: Message | null, errorCode: ApiErrorCode, errorMessage: string) => void;
}

interface StreamOutcome {
  content: string;
  inputTokens: number;
  outputTokens: number;
  interrupted: boolean;
  firstTokenTimedOut: boolean;
}

@Injectable()
export class AiReplyService {
  private readonly logger = new Logger(AiReplyService.name);

  constructor(
    @Inject(AiGenLockService) private readonly lock: AiGenLockService,
    @Inject(RetrievalService) private readonly retrieval: RetrievalService,
    @Inject(AiGenerationRegistry) private readonly registry: AiGenerationRegistry,
    @Inject(QuotaService) private readonly quota: QuotaService,
  ) {}

  async generateReply(params: {
    organizationId: string;
    chatbotId: string;
    conversationId: string;
    customerMessage: string;
    callbacks: AiReplyCallbacks;
  }): Promise<void> {
    const locked = await this.lock.acquire(params.conversationId);
    if (!locked) return; // another generation is already in flight for this conversation

    try {
      await this.run(params);
    } finally {
      this.registry.unregister(params.conversationId);
      await this.lock.release(params.conversationId);
    }
  }

  /** Section 7 T2: a customer requesting handoff mid-generation aborts the in-flight stream. */
  abort(conversationId: string): boolean {
    return this.registry.abort(conversationId);
  }

  private async run(params: {
    organizationId: string;
    chatbotId: string;
    conversationId: string;
    customerMessage: string;
    callbacks: AiReplyCallbacks;
  }): Promise<void> {
    const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: params.chatbotId } });
    const { insufficientKnowledge, context } = await this.retrieval.retrieve(params.organizationId, params.chatbotId, params.customerMessage);

    const streamId = randomUUID();
    params.callbacks.onStarted(streamId);

    if (insufficientKnowledge) {
      const message = await insertMessageSerialized({
        id: streamId,
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        senderType: "AI",
        content: INSUFFICIENT_KNOWLEDGE_FALLBACK,
        streamStatus: "COMPLETED",
        citations: [],
        insufficientKnowledge: true,
        retrieval: { skipped: "no chunk within maxCosineDistance" },
      });
      params.callbacks.onChunk(streamId, 0, INSUFFICIENT_KNOWLEDGE_FALLBACK);
      params.callbacks.onCompleted(message);
      return;
    }

    const history = await this.recentHistory(params.conversationId);
    const messages = buildChatMessages({
      tenantSystemPrompt: chatbot.systemPrompt,
      context,
      history,
      customerMessage: params.customerMessage,
    });

    // Section 8 "Token reservation": estimate = counted prompt tokens + maxAnswerTokens, reserved
    // atomically against both the monthly and (per-chatbot) daily counters before the LLM is called.
    const estimatedTokens = messages.reduce((sum, m) => sum + countTokens(m.content), 0) + DEFAULTS.rag.maxAnswerTokens;
    const reservation = await this.quota.reserveAiTokens({
      organizationId: params.organizationId,
      chatbotId: params.chatbotId,
      conversationId: params.conversationId,
      estimatedTokens,
      dailyCap: resolve(chatbot.dailyTokenCap, DEFAULTS.quota.dailyTokenCapPerChatbot),
    });
    if (!reservation.ok) {
      const code = reservation.reason === "QUOTA_EXCEEDED" ? ApiErrorCode.QUOTA_EXCEEDED : ApiErrorCode.DAILY_CAP_EXCEEDED;
      params.callbacks.onFailed(streamId, null, code, "The AI usage limit for this period has been reached");
      return;
    }

    const provider = getLlmProvider();
    let chunkIndex = 0;
    const emitChunk = (delta: string) => params.callbacks.onChunk(streamId, chunkIndex++, delta);

    let result: StreamOutcome;
    try {
      result = await this.streamWithTimeouts(params.conversationId, provider, messages, emitChunk);
      if (result.firstTokenTimedOut) {
        result = await this.streamWithTimeouts(params.conversationId, provider, messages, emitChunk); // retry once, first-token only
      }
    } catch (err) {
      this.logger.error(`AI generation failed for conversation ${params.conversationId}`, err as Error);
      await this.quota.release(reservation.reservationId);
      params.callbacks.onFailed(streamId, null, ApiErrorCode.LLM_UNAVAILABLE, "The AI provider is temporarily unavailable");
      return;
    }

    const { answerText, citations, insufficientKnowledge: modelSaysInsufficient } = parseTrailer(result.content);
    const validatedCitations = validateCitations(citations, context);

    const message = await insertMessageSerialized({
      id: streamId,
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      senderType: "AI",
      content: answerText,
      streamStatus: result.interrupted ? "INTERRUPTED" : "COMPLETED",
      citations: validatedCitations,
      insufficientKnowledge: modelSaysInsufficient,
      retrieval: context.map((c) => ({ chunkId: c.chunkId, distance: c.distance })),
    });

    await this.quota.reconcile(reservation.reservationId, result.inputTokens + result.outputTokens);
    await prisma.aiUsage.create({
      data: {
        organizationId: params.organizationId,
        chatbotId: params.chatbotId,
        conversationId: params.conversationId,
        messageId: message.id,
        usageType: "CHAT_COMPLETION",
        model: provider.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        estimatedCostMicros: BigInt(
          Math.round(
            (result.inputTokens / 1_000_000) * DEFAULTS.pricing.perMillionInput +
              (result.outputTokens / 1_000_000) * DEFAULTS.pricing.perMillionOutput,
          ),
        ),
      },
    });

    params.callbacks.onCompleted(message);
  }

  private async recentHistory(conversationId: string): Promise<HistoryMessage[]> {
    const rows = await prisma.message.findMany({
      where: { conversationId, senderType: { in: ["CUSTOMER", "AI"] } },
      orderBy: { seq: "desc" },
      take: DEFAULTS.rag.historyMessages,
    });
    return rows
      .reverse()
      .map((row) => ({ role: row.senderType === "CUSTOMER" ? ("user" as const) : ("assistant" as const), content: row.content }));
  }

  private async streamWithTimeouts(
    conversationId: string,
    provider: ReturnType<typeof getLlmProvider>,
    messages: ChatMessage[],
    onChunk: (delta: string) => void,
  ): Promise<StreamOutcome> {
    const controller = new AbortController();
    this.registry.register(conversationId, controller);
    let firstTokenReceived = false;
    let firstTokenTimedOut = false;

    const firstTokenTimer = setTimeout(() => {
      if (!firstTokenReceived) {
        firstTokenTimedOut = true;
        controller.abort();
      }
    }, DEFAULTS.llm.firstTokenTimeoutMs);
    const totalTimer = setTimeout(() => controller.abort(), DEFAULTS.llm.requestTimeoutMs);

    try {
      const result = await provider.streamChatCompletion({
        messages,
        maxTokens: DEFAULTS.rag.maxAnswerTokens,
        temperature: DEFAULTS.rag.temperature,
        signal: controller.signal,
        onChunk: (delta) => {
          firstTokenReceived = true;
          onChunk(delta);
        },
      });
      return { ...result, firstTokenTimedOut: firstTokenTimedOut && !firstTokenReceived };
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(totalTimer);
    }
  }
}
