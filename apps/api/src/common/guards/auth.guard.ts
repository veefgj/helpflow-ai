// Global guard (registered as APP_GUARD): verifies the 15-minute access JWT (ADR-005) on every
// route except those marked @Public() (register/login/refresh, widget routes, webhooks, health).
import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { RequestWithUser } from "../request-context";

interface AccessTokenPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  // tsx/esbuild emits no decorator metadata, so every param needs an explicit @Inject(token).
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
    if (!token) {
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Missing access token");
    }

    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token);
      req.userId = payload.sub;
      req.userEmail = payload.email;
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === "TokenExpiredError") {
        throw new HelpFlowApiException(ApiErrorCode.TOKEN_EXPIRED, "Access token expired");
      }
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Invalid access token");
    }
  }
}
