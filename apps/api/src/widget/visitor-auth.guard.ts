// Widget customer requests authenticate with the visitor token (Section 6 "Access"), carried in the
// X-Visitor-Token header — distinct from the staff Authorization: Bearer access JWT.
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { verifyVisitorToken, type VisitorTokenPayload } from "./visitor-token";
import type { Request } from "express";

export type RequestWithVisitor = Request & { visitor: VisitorTokenPayload };

@Injectable()
export class VisitorAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithVisitor>();
    const token = req.headers["x-visitor-token"];
    if (typeof token !== "string") {
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Missing visitor token");
    }
    const payload = verifyVisitorToken(token);
    if (!payload) {
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Invalid or expired visitor token");
    }
    req.visitor = payload;
    return true;
  }
}
