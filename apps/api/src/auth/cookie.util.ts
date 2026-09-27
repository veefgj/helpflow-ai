import type { Response } from "express";
import { DEFAULTS } from "@helpflow/config";

const isProd = process.env.NODE_ENV === "production";

export function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie(DEFAULTS.auth.refreshCookieName, rawToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: DEFAULTS.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(DEFAULTS.auth.refreshCookieName, { path: "/api/auth" });
}
