// Resolves the caller's membership for the :orgId path segment (Section 4 "Tenant invariant").
// A client-supplied organizationId is never trusted by itself — cross-tenant access, a
// non-existent org, or a non-member all return the same 404 rather than revealing which.
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { prisma } from "@helpflow/database";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import type { RequestWithMembership } from "../request-context";

@Injectable()
export class OrgMembershipGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithMembership>();
    const orgId = String(req.params.orgId);

    const membership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: req.userId } },
    });
    if (!membership) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Organization not found");
    }

    const organization = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!organization || organization.deletedAt) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_NOT_FOUND, "Organization not found");
    }
    if (membership.disabledReason) {
      throw new HelpFlowApiException(ApiErrorCode.RESOURCE_DISABLED, "Your membership in this workspace is disabled");
    }

    req.membership = membership;
    return true;
  }
}
