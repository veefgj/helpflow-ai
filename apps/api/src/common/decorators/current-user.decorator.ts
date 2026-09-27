import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestWithUser } from "../request-context";

export interface CurrentUserPayload {
  userId: string;
  userEmail: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  return { userId: req.userId, userEmail: req.userEmail };
});
