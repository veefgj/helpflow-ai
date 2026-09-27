import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { prisma } from "@helpflow/database";
import { DEFAULTS } from "@helpflow/config";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser, type CurrentUserPayload } from "../common/decorators/current-user.decorator";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { clearRefreshCookie, setRefreshCookie } from "./cookie.util";

function readRefreshCookie(req: Request): string {
  const raw = req.cookies?.[DEFAULTS.auth.refreshCookieName];
  if (!raw) {
    throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Missing refresh token");
  }
  return raw;
}

@Controller("api")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: "auth-register", ...DEFAULTS.rateLimit.authPerIp, failOpen: true })
  @Post("auth/register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto);
    setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: "auth-login", ...DEFAULTS.rateLimit.authPerIp, failOpen: true })
  @HttpCode(HttpStatus.OK)
  @Post("auth/login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("auth/refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = readRefreshCookie(req);
    const result = await this.auth.refresh(rawToken);
    setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @HttpCode(HttpStatus.OK)
  @Post("auth/logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[DEFAULTS.auth.refreshCookieName];
    if (raw) await this.auth.logout(raw);
    clearRefreshCookie(res);
    return { ok: true };
  }

  @Get("me")
  async me(@CurrentUser() currentUser: CurrentUserPayload) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser.userId } });
    const memberships = await prisma.membership.findMany({
      where: { userId: currentUser.userId },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        role: m.role,
        disabledReason: m.disabledReason,
      })),
    };
  }
}
