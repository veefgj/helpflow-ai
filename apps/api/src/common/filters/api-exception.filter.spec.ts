import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { ApiExceptionFilter } from "./api-exception.filter";

function createHost(requestId = "req-1") {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ requestId }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe("ApiExceptionFilter", () => {
  const filter = new ApiExceptionFilter();

  it("maps HelpFlowApiException to its declared code, status and details", () => {
    const { host, status, json } = createHost("req-42");
    const exception = new HelpFlowApiException(ApiErrorCode.QUOTA_EXCEEDED, "monthly limit reached", { limit: 50_000 });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith({
      code: "QUOTA_EXCEEDED",
      message: "monthly limit reached",
      requestId: "req-42",
      details: { limit: 50_000 },
    });
  });

  it("maps a NestJS NotFoundException to RESOURCE_NOT_FOUND", () => {
    const { host, status, json } = createHost();
    filter.catch(new NotFoundException("nope"), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
  });

  it("falls back to INTERNAL_ERROR for an unrecognized error and never leaks its message", () => {
    const { host, status, json } = createHost();
    filter.catch(new Error("stack trace with secrets"), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "INTERNAL_ERROR", message: "Internal error" }));
  });
});
