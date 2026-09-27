// Section 9 "Invitations": SHA-256 token hash, 72h expiry, single use, accepting user's email must
// match. Every failure path returns the same INVITATION_INVALID — never reveal which check failed.
import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { DEFAULTS, loadEnv } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import type { CreateInvitationDto } from "./dto/create-invitation.dto";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

@Injectable()
export class InvitationsService {
  async create(organizationId: string, invitedById: string, dto: CreateInvitationDto) {
    const rawToken = randomBytes(32).toString("hex");
    const invitation = await prisma.invitation.create({
      data: {
        organizationId,
        email: dto.email.toLowerCase(),
        role: dto.role,
        tokenHash: hashToken(rawToken),
        invitedById,
        expiresAt: new Date(Date.now() + DEFAULTS.invitation.ttlHours * 60 * 60 * 1000),
      },
    });

    const env = loadEnv();
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      // Returned once: the raw token is never retrievable again (only its hash is stored).
      inviteUrl: `${env.APP_URL}/invitations/accept?token=${rawToken}`,
    };
  }

  async list(organizationId: string) {
    return prisma.invitation.findMany({
      where: { organizationId, revokedAt: null, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
  }

  async revoke(organizationId: string, invitationId: string): Promise<void> {
    const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Invitation not found");
    }
    await prisma.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
  }

  async accept(userId: string, userEmail: string, rawToken: string): Promise<{ organizationId: string }> {
    const invalid = () => new HelpFlowApiException(ApiErrorCode.INVITATION_INVALID, "This invitation is no longer valid");

    const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!invitation) throw invalid();
    if (invitation.revokedAt) throw invalid();
    if (invitation.acceptedAt) throw invalid();
    if (invitation.expiresAt < new Date()) throw invalid();
    if (invitation.email !== userEmail.toLowerCase()) throw invalid();

    await prisma.$transaction([
      prisma.membership.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
        create: { organizationId: invitation.organizationId, userId, role: invitation.role },
        update: { role: invitation.role, disabledReason: null },
      }),
      prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    ]);

    return { organizationId: invitation.organizationId };
  }
}
