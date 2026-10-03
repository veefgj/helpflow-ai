// Section 7 T4/T5 (handoff-timeout) and T6 (agent-grace). Each job re-checks the conversation's
// current state with a conditional UPDATE, so a stale timer (already accepted, released, or closed
// by the time it fires) is harmless — it simply updates zero rows and does nothing.
import { Job, Worker } from "bullmq";
import { DEFAULTS } from "@helpflow/config";
import { prisma, conditionalTransition, insertMessageSerialized, resolveConversationLanguage, type Conversation } from "@helpflow/database";
import { t, type I18nKey } from "@helpflow/types";
import { createRedisConnection } from "../redis";
import { emitConversationUpdated, emitInboxUpdated, emitMessageCreated } from "../realtime";
import { toConversationDto, toMessageDto } from "../mappers";
import { scheduleHandoffTimeout } from "./conversation-timers-queue";

async function announceTransition(conversation: Conversation, systemMessage: I18nKey): Promise<void> {
  const message = await insertMessageSerialized({
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    senderType: "SYSTEM",
    content: t(await resolveConversationLanguage(conversation), systemMessage),
  });
  emitMessageCreated(conversation.id, toMessageDto(message));
  const dto = toConversationDto(conversation);
  emitConversationUpdated(dto);
  emitInboxUpdated(conversation.organizationId, { conversation: dto });
}

export async function handleHandoffTimeout(job: Job<{ conversationId: string }>): Promise<void> {
  const conversation = await prisma.conversation.findUnique({ where: { id: job.data.conversationId } });
  if (!conversation || conversation.status !== "WAITING_AGENT") return; // stale — already accepted/closed

  const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: conversation.chatbotId } });

  if (chatbot.unavailablePolicy === "RESUME_AI") {
    // T4
    const updated = await conditionalTransition({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      from: "WAITING_AGENT",
      set: { status: "AI_ACTIVE", handoffRequestedAt: null },
    });
    if (updated) await announceTransition(updated, "timeoutResumeAi");
  } else {
    // T5
    const updated = await conditionalTransition({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      from: "WAITING_AGENT",
      set: { status: "CLOSED", closedAt: new Date(), closeReason: "AGENT_UNAVAILABLE" },
    });
    if (updated) await announceTransition(updated, "timeoutCollectEmail");
  }
}

export async function handleAgentGrace(job: Job<{ conversationId: string }>): Promise<void> {
  const conversation = await prisma.conversation.findUnique({ where: { id: job.data.conversationId } });
  if (!conversation || conversation.status !== "AGENT_ACTIVE") return; // stale — agent reconnected, or already closed/released

  // T6
  const updated = await conditionalTransition({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    from: "AGENT_ACTIVE",
    set: { status: "WAITING_AGENT", assignedAgentId: null, assignedAt: null, handoffRequestedAt: new Date() },
  });
  if (!updated) return;

  await scheduleHandoffTimeout(conversation.id, DEFAULTS.handoff.waitingTimeoutSec);
  await announceTransition(updated, "agentDisconnected");
}

export function startConversationTimersWorker(): Worker {
  return new Worker(
    DEFAULTS.jobs.queues.conversationTimers,
    async (job) => {
      if (job.name === "handoff-timeout") return handleHandoffTimeout(job);
      if (job.name === "agent-grace") return handleAgentGrace(job);
    },
    { connection: createRedisConnection() },
  );
}
