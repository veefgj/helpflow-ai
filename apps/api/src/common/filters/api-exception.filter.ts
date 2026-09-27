// Global exception filter: maps every error to the shared ApiError shape (docs/api-contract.md,
// packages/types/api-errors.ts). requestId always matches the X-Request-Id header and the log line.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Response } from "express";
import { ApiErrorCode, HTTP_STATUS, HelpFlowApiException, type ApiError } from "@helpflow/types";
import type { RequestWithId } from "../middleware/request-with-id";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();
    const requestId = req.requestId ?? "unknown";

    const { status, body } = this.toApiError(exception, requestId);
    res.status(status).json(body);
  }

  private toApiError(exception: unknown, requestId: string): { status: number; body: ApiError } {
    if (exception instanceof HelpFlowApiException) {
      return {
        status: HTTP_STATUS[exception.code],
        body: { code: exception.code, message: exception.message, requestId, details: exception.details },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 404
          ? ApiErrorCode.RESOURCE_NOT_FOUND
          : status === 401
            ? ApiErrorCode.UNAUTHENTICATED
            : status === 403
              ? ApiErrorCode.FORBIDDEN
              : status === 400
                ? ApiErrorCode.VALIDATION_ERROR
                : ApiErrorCode.INTERNAL_ERROR;
      const response = exception.getResponse();
      const message = typeof response === "string" ? response : ((response as { message?: string }).message ?? exception.message);
      return {
        status,
        body: { code, message, requestId },
      };
    }

    console.error(exception);
    return {
      status: HTTP_STATUS[ApiErrorCode.INTERNAL_ERROR],
      body: { code: ApiErrorCode.INTERNAL_ERROR, message: "Internal error", requestId },
    };
  }
}
