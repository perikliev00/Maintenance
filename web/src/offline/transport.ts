import {
  fetchWithAuthRetry,
  refreshAccessToken,
} from "../api/http";
import { markReachable } from "./connState";

const REQUEST_TIMEOUT_MS = 8000;

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function authHeader(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutErr = new Error("Request timed out") as Error & {
        status?: number;
      };
      timeoutErr.status = undefined;
      throw timeoutErr;
    }
    const networkErr = new Error(
      err instanceof Error ? err.message : "Network error",
    ) as Error & { status?: number };
    networkErr.status = undefined;
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }
}

type RefreshFn = () => Promise<"refreshed" | "rejected" | "transient">;

/**
 * POST JSON with cookie auth. On 401, single-flight refresh (shared with
 * api/client) then retry once with the same body/commandId and fresh CSRF.
 * Exported for unit tests with injectable transport.
 */
export async function postJsonWithSessionRefresh(
  url: string,
  body: Record<string, unknown>,
  deps: {
    fetchFn?: typeof fetchWithTimeout;
    refreshFn?: RefreshFn;
    headersFn?: () => HeadersInit;
  } = {},
): Promise<unknown> {
  const fetchFn = deps.fetchFn ?? fetchWithTimeout;
  const headersFn = deps.headersFn ?? authHeader;
  const refreshFn = deps.refreshFn ?? refreshAccessToken;

  const res = await fetchWithAuthRetry(
    () =>
      fetchFn(url, {
        method: "POST",
        credentials: "include",
        headers: headersFn(),
        body: JSON.stringify(body),
      }),
    { refreshFn },
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data as { message?: string; error?: string }).message ??
      (data as { error?: string }).error ??
      `HTTP ${res.status}`;
    const err = new Error(message) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
    };
    err.status = res.status;
    err.code = (data as { error?: string }).error;
    err.details = (data as { details?: unknown }).details;
    throw err;
  }
  markReachable();
  return data;
}

export async function postJson(url: string, body: Record<string, unknown>) {
  return postJsonWithSessionRefresh(url, body);
}
