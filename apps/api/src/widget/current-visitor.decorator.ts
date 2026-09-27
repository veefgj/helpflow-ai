import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestWithVisitor } from "./visitor-auth.guard";
import type { VisitorTokenPayload } from "./visitor-token";

export const CurrentVisitor = createParamDecorator((_data: unknown, ctx: ExecutionContext): VisitorTokenPayload => {
  return ctx.switchToHttp().getRequest<RequestWithVisitor>().visitor;
});
