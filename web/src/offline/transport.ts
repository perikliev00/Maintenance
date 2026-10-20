/**
 * Offline drain transport: timed POSTs with cookie auth + CSRF.
 * Shares `fetchWithAuthRetry` / `refreshAccessToken` with `api/http` so a 401
 * during sync uses the same single-flight refresh as interactive API calls.
 */
import {
  fetchWithAuthRetry,
  refreshAccessToken,
} from "../api/http";
import { markReachable } from "./connState";

/** Fail fast so drain can mark unreachable and backoff instead of hanging. */
const REQUEST_TIMEOUT_MS = 8000;

/** Read the double-submit CSRF cookie (same as api/http). */
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** JSON + CSRF for outbox POSTs (always mutating, so CSRF is always attached when present). */
export function authHeader(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const csrf = getCsrfToken();
  // Cookie may be missing briefly after login before Set-Cookie lands.
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

/**
 * `fetch` with AbortController timeout. Errors expose `status: undefined` so
 * callers treat them as network/unreachable (queueable) rather than 4xx.
 */
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
    // Timeout abort → queueable network error (no HTTP status).
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutErr = new Error("Request timed out") as Error & {
        status?: number;
      };
      timeoutErr.status = undefined;
      throw timeoutErr;
    }
    // Other fetch failures (DNS, offline) — also queueable.
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
    beforeAttempt?: () => void;
  } = {},
): Promise<unknown> {
  // Injectable deps keep unit tests free of real network / cookie state.
  const fetchFn = deps.fetchFn ?? fetchWithTimeout;
  const headersFn = deps.headersFn ?? authHeader;
  const refreshFn = deps.refreshFn ?? refreshAccessToken;

  // Rebuild headers on each attempt so post-refresh CSRF is current.
  const res = await fetchWithAuthRetry(
    () =>
      fetchFn(url, {
        method: "POST",
        credentials: "include",
        headers: headersFn(),
        body: JSON.stringify(body),
      }),
    { refreshFn, beforeAttempt: deps.beforeAttempt },
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Attach status/code/details so drain can classify conflict vs failed.
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
  // Successful I/O clears the unreachable latch for the banner.
  markReachable();
  return data;
}

/** Convenience alias used by drain and run-or-enqueue paths. */
export async function postJson(url: string, body: Record<string, unknown>) {
  return postJsonWithSessionRefresh(url, body);
}
