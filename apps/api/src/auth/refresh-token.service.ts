// ADR-005: opaque refresh token, rotated on every use, with family-based reuse detection.
// The raw token only ever exists in the httpOnly cookie; the database stores its SHA-256 hash.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function expiryDate(): Date {
  return new Date(Date.now() + DEFAULTS.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

@Injectable()
export class RefreshTokenService {
  /** New login/registration: starts a fresh rotation family. */
  async issue(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString("hex");
    await prisma.refreshToken.create({
      data: {
        userId,
        familyId: randomUUID(),
        tokenHash: hashToken(rawToken),
        expiresAt: expiryDate(),
      },
    });
    return rawToken;
  }

  /**
   * Validates the presented raw token and rotates it. Throws UNAUTHENTICATED on any invalid,
   * expired or already-used token — reuse of an already-rotated token revokes the whole family.
   */
  async rotate(rawToken: string): Promise<{ userId: string; rawToken: string }> {
    const tokenHash = hashToken(rawToken);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Invalid refresh token");
    }

    if (existing.revokedAt) {
      // Someone presented a token that was already rotated away — treat as theft and burn the family.
      await prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Refresh token reuse detected");
    }

    if (existing.expiresAt < new Date()) {
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Refresh token expired");
    }

    const newRawToken = randomBytes(32).toString("hex");
    await prisma.$transaction([
      prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } }),
      prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: hashToken(newRawToken),
          expiresAt: expiryDate(),
        },
      }),
    ]);

    return { userId: existing.userId, rawToken: newRawToken };
  }

  /** Logout: revoke the presented token so it (and a stolen copy of it) can never be rotated again. */
  async revoke(rawToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
