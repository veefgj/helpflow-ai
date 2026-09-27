// Appendix B Q4 + Section 8 "Token reservation and reconciliation": atomically reserve the
// estimate only when used + reserved + estimate <= limit, on both the monthly counter and the
// chatbot's daily counter. Raw SQL only — Prisma's query builder can't express a WHERE clause that
// compares an arithmetic expression across columns to a bound value.
import { randomUUID } from "node:crypto";
import { prisma } from "../client";

export interface ReserveTokensParams {
  organizationId: string;
  chatbotId: string;
  conversationId: string;
  estimatedTokens: number;
  periodStart: Date;
  periodEnd: Date;
  /** null = unlimited (BUSINESS plan) — the monthly check is skipped entirely. */
  monthlyLimit: number | null;
  dailyCap: number;
}

export type ReserveTokensResult =
  | { ok: true; reservationId: string; usageCounterId: string; day: Date }
  | { ok: false; reason: "QUOTA_EXCEEDED" | "DAILY_CAP_EXCEEDED" };

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function reserveTokens(params: ReserveTokensParams): Promise<ReserveTokensResult> {
  const day = utcDay(new Date());

  return prisma.$transaction(async (tx) => {
    const counter = await tx.usageCounter.upsert({
      where: { organizationId_periodStart: { organizationId: params.organizationId, periodStart: params.periodStart } },
      create: { organizationId: params.organizationId, periodStart: params.periodStart, periodEnd: params.periodEnd },
      update: {},
    });

    if (params.monthlyLimit !== null) {
      const monthlyRows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE usage_counters SET "aiTokensReserved" = "aiTokensReserved" + ${params.estimatedTokens}
        WHERE id = ${counter.id} AND "aiTokensUsed" + "aiTokensReserved" + ${params.estimatedTokens} <= ${params.monthlyLimit}
        RETURNING id
      `;
      if (monthlyRows.length === 0) return { ok: false, reason: "QUOTA_EXCEEDED" };
    }

    await tx.$executeRaw`
      INSERT INTO chatbot_daily_usage ("chatbotId", day, "organizationId") VALUES (${params.chatbotId}, ${day}, ${params.organizationId})
      ON CONFLICT DO NOTHING
    `;
    const dailyRows = await tx.$queryRaw<Array<{ chatbotId: string }>>`
      UPDATE chatbot_daily_usage SET "aiTokensReserved" = "aiTokensReserved" + ${params.estimatedTokens}
      WHERE "chatbotId" = ${params.chatbotId} AND day = ${day}
        AND "aiTokensUsed" + "aiTokensReserved" + ${params.estimatedTokens} <= ${params.dailyCap}
      RETURNING "chatbotId"
    `;
    if (dailyRows.length === 0) {
      // Roll back the monthly reservation we just took (the transaction aborts on throw, but we
      // want a typed result instead) — undo manually since we're still inside the same tx.
      if (params.monthlyLimit !== null) {
        await tx.usageCounter.update({ where: { id: counter.id }, data: { aiTokensReserved: { decrement: params.estimatedTokens } } });
      }
      return { ok: false, reason: "DAILY_CAP_EXCEEDED" };
    }

    const reservationId = randomUUID();
    await tx.tokenReservation.create({
      data: {
        id: reservationId,
        organizationId: params.organizationId,
        chatbotId: params.chatbotId,
        usageCounterId: counter.id,
        day,
        conversationId: params.conversationId,
        estimatedTokens: params.estimatedTokens,
      },
    });

    return { ok: true, reservationId, usageCounterId: counter.id, day };
  });
}

/** Settles a RESERVED row exactly once: moves the estimate out of reserved and the actual into used. */
export async function reconcileReservation(reservationId: string, actualTokens: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.tokenReservation.updateMany({
      where: { id: reservationId, status: "RESERVED" },
      data: { status: "RECONCILED", actualTokens, settledAt: new Date() },
    });
    if (reservation.count === 0) return; // already settled — never double-apply

    const row = await tx.tokenReservation.findUniqueOrThrow({ where: { id: reservationId } });
    await tx.usageCounter.update({
      where: { id: row.usageCounterId },
      data: { aiTokensReserved: { decrement: row.estimatedTokens }, aiTokensUsed: { increment: actualTokens } },
    });
    await tx.chatbotDailyUsage.update({
      where: { chatbotId_day: { chatbotId: row.chatbotId, day: row.day } },
      data: { aiTokensReserved: { decrement: row.estimatedTokens }, aiTokensUsed: { increment: actualTokens } },
    });
  });
}

/** On failure: release the reservation without recording any usage. */
export async function releaseReservation(reservationId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.tokenReservation.updateMany({
      where: { id: reservationId, status: "RESERVED" },
      data: { status: "RELEASED", settledAt: new Date() },
    });
    if (reservation.count === 0) return;

    const row = await tx.tokenReservation.findUniqueOrThrow({ where: { id: reservationId } });
    await tx.usageCounter.update({ where: { id: row.usageCounterId }, data: { aiTokensReserved: { decrement: row.estimatedTokens } } });
    await tx.chatbotDailyUsage.update({
      where: { chatbotId_day: { chatbotId: row.chatbotId, day: row.day } },
      data: { aiTokensReserved: { decrement: row.estimatedTokens } },
    });
  });
}

/** Maintenance sweep: settle (release) reservations that crashed before ever reconciling. */
export async function releaseStaleReservations(olderThan: Date): Promise<number> {
  const stale = await prisma.tokenReservation.findMany({ where: { status: "RESERVED", createdAt: { lt: olderThan } } });
  for (const r of stale) await releaseReservation(r.id);
  return stale.length;
}
