import type { Request } from "express";

/** Set by RequestIdMiddleware for every route; read by the logger and the global exception filter. */
export type RequestWithId = Request & { requestId: string };
