import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { prisma, type Membership, type Role } from "@helpflow/database";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { canManageMember } from "./rbac.policy";
import type { CreateOrganizationDto } from "./dto/create-organization.dto";
import type { UpdateOrganizationDto } from "./dto/update-organization.dto";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "workspace") + "-" + randomUUID().slice(0, 6);
}

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result;
}

@Injectable()
export class OrganizationsService {
  async create(userId: string, dto: CreateOrganizationDto) {
    const freePlan = await prisma.plan.findUniqueOrThrow({ where: { code: "FREE" } });
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: dto.name, slug: slugify(dto.name), quotaAnchorAt: now },
      });
      await tx.membership.create({ data: { organizationId: org.id, userId, role: "OWNER" } });
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: freePlan.id,
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: addOneMonth(now),
        },
      });
      return org;
    });
  }

  async update(organizationId: string, dto: UpdateOrganizationDto) {
    return prisma.organization.update({ where: { id: organizationId }, data: { name: dto.name } });
  }

  async softDelete(organizationId: string): Promise<void> {
    await prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: new Date() } });
  }

  async listMembers(organizationId: string) {
    const members = await prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({
      id: m.id,
      role: m.role,
      disabledReason: m.disabledReason,
      createdAt: m.createdAt,
      user: m.user,
    }));
  }

  async updateMemberRole(organizationId: string, actor: Membership, memberId: string, newRole: Role) {
    const target = await this.requireOrgMember(organizationId, memberId);

    if (!canManageMember(actor.role, target.role, newRole)) {
      throw new HelpFlowApiException(ApiErrorCode.FORBIDDEN, "You cannot change this member's role");
    }

    return prisma.membership.update({ where: { id: memberId }, data: { role: newRole } });
  }

  async removeMember(organizationId: string, actor: Membership, memberId: string): Promise<void> {
    const target = await this.requireOrgMember(organizationId, memberId);

    if (!canManageMember(actor.role, target.role, null)) {
      throw new HelpFlowApiException(ApiErrorCode.FORBIDDEN, "You cannot remove this member");
    }

    await prisma.membership.delete({ where: { id: memberId } });
  }

  async transferOwnership(organizationId: string, currentOwner: Membership, targetMemberId: string): Promise<void> {
    const target = await this.requireOrgMember(organizationId, targetMemberId);
    if (target.disabledReason) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_DISABLED, "That member is disabled");
    }
    if (target.id === currentOwner.id) {
      throw new HelpFlowApiException(ApiErrorCode.VALIDATION_ERROR, "You are already the owner");
    }

    await prisma.$transaction([
      prisma.membership.update({ where: { id: currentOwner.id }, data: { role: "ADMIN" } }),
      prisma.membership.update({ where: { id: target.id }, data: { role: "OWNER" } }),
    ]);
  }

  private async requireOrgMember(organizationId: string, membershipId: string): Promise<Membership> {
    const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.organizationId !== organizationId) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Member not found");
    }
    return membership;
  }
}
