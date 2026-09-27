import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { RequestWithId } from "./request-with-id";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers["x-request-id"] as string) || randomUUID();
    (req as RequestWithId).requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  }
}
