import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Membership } from "@helpflow/database";
import type { RequestWithMembership } from "../request-context";

export const CurrentMembership = createParamDecorator((_data: unknown, ctx: ExecutionContext): Membership => {
  const req = ctx.switchToHttp().getRequest<RequestWithMembership>();
  return req.membership;
});
