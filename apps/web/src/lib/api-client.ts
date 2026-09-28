"use client";

import { ApiErrorCode, type ApiError } from "@helpflow/types";
import { useAuthStore } from "./auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiRequestError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(error: ApiError, status: number) {
    super(error.message);
    this.code = error.code;
    this.status = status;
    this.details = error.details;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/** POST /api/auth/refresh relies on the httpOnly refresh cookie — never held in JS. Deduplicated so
 * concurrent 401s from several in-flight requests only trigger one refresh call. */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string };
        useAuthStore.getState().setAccessToken(data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown; // JSON-serialized automatically unless it's already a FormData
  skipAuthRetry?: boolean; // internal — prevents infinite retry loops
}

/** Every dashboard API call goes through this: attaches the bearer token, retries exactly once
 * after a silent refresh on TOKEN_EXPIRED, and normalizes every non-2xx response into ApiRequestError. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, skipAuthRetry, headers, ...rest } = options;
  const accessToken = useAuthStore.getState().accessToken;
  const isFormData = body instanceof FormData;

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json() : undefined;

  if (res.ok) return payload as T;

  const error = payload as ApiError;
  if (error?.code === ApiErrorCode.TOKEN_EXPIRED && !skipAuthRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) return apiFetch<T>(path, { ...options, skipAuthRetry: true });
    useAuthStore.getState().clear();
  }
  throw new ApiRequestError(error ?? { code: ApiErrorCode.INTERNAL_ERROR, message: "Request failed", requestId: "unknown" }, res.status);
}
