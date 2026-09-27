import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@helpflow/database";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { ROLES_KEY } from "../decorators/roles.decorator";
import type { RequestWithMembership } from "../request-context";

/** Runs after OrgMembershipGuard — checks req.membership.role against @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  // tsx/esbuild emits no decorator metadata, so the param needs an explicit @Inject(token).
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithMembership>();
    if (!roles.includes(req.membership.role)) {
      throw new HelpFlowApiException(ApiErrorCode.FORBIDDEN, "Your role does not allow this action");
    }
    return true;
  }
}
