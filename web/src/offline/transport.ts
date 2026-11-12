/**
 * Offline drain transport: timed POSTs with cookie auth + CSRF.
 * Shares `fetchWithAuthRetry` / `refreshAccessToken` with `api/http` so a 401
 * during sync uses the same single-flight refresh as interactive API calls.
 */
import {
  // List item in import/export/params.
  fetchWithAuthRetry,
  // List item in import/export/params.
  refreshAccessToken,
// Close multi-line construct with trailing syntax.
} from "../api/http";
// Import dependency used by this module.
import { markReachable } from "./connState";

/** Fail fast so drain can mark unreachable and backoff instead of hanging. */
const REQUEST_TIMEOUT_MS = 8000;

/** Read the double-submit CSRF cookie (same as api/http). */
function getCsrfToken(): string | null {
  // Local constant binding.
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  // Return computed result to caller.
  return match ? decodeURIComponent(match[1]!) : null;
}

/** JSON + CSRF for outbox POSTs (always mutating, so CSRF is always attached when present). */
export function authHeader(): HeadersInit {
  // Local constant binding.
  const headers: Record<string, string> = {
    // Continue multi-line list/arguments.
    "Content-Type": "application/json",
  };
  // Local constant binding.
  const csrf = getCsrfToken();
  // Cookie may be missing briefly after login before Set-Cookie lands.
  if (csrf) headers["X-CSRF-Token"] = csrf;
  // Return computed result to caller.
  return headers;
}

/**
 * `fetch` with AbortController timeout. Errors expose `status: undefined` so
 * callers treat them as network/unreachable (queueable) rather than 4xx.
 */
export async function fetchWithTimeout(
  // Field/property in this shape.
  url: string,
  // Field/property in this shape.
  init: RequestInit,
// Open multi-line construct.
): Promise<Response> {
  // Local constant binding.
  const controller = new AbortController();
  // Local constant binding.
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Guard fallible work.
  try {
    // Return computed result to caller.
    return await fetch(url, {
      // Spread remaining fields/props.
      ...init,
      // Field/property in this shape.
      signal: controller.signal,
    });
  // Invoke helper or pass arguments.
  } catch (err) {
    // Timeout abort → queueable network error (no HTTP status).
    if (err instanceof DOMException && err.name === "AbortError") {
      // Local constant binding.
      const timeoutErr = new Error("Request timed out") as Error & {
        // Field/property in this shape.
        status?: number;
      };
      // Assign value for subsequent use.
      timeoutErr.status = undefined;
      // Abort with an error for the caller.
      throw timeoutErr;
    }
    // Other fetch failures (DNS, offline) — also queueable.
    const networkErr = new Error(
      // Continue multi-line list/arguments.
      err instanceof Error ? err.message : "Network error",
    // Close multi-line construct with trailing syntax.
    ) as Error & { status?: number };
    // Assign value for subsequent use.
    networkErr.status = undefined;
    // Abort with an error for the caller.
    throw networkErr;
  // Open multi-line construct.
  } finally {
    // Invoke helper or pass arguments.
    clearTimeout(timer);
  }
}

// Local type alias shaping data.
type RefreshFn = () => Promise<"refreshed" | "rejected" | "transient">;

/**
 * POST JSON with cookie auth. On 401, single-flight refresh (shared with
 * api/client) then retry once with the same body/commandId and fresh CSRF.
 * Exported for unit tests with injectable transport.
 */
export async function postJsonWithSessionRefresh(
  // Field/property in this shape.
  url: string,
  // Field/property in this shape.
  body: Record<string, unknown>,
  // Field/property in this shape.
  deps: {
    // Field/property in this shape.
    fetchFn?: typeof fetchWithTimeout;
    // Field/property in this shape.
    refreshFn?: RefreshFn;
    // Arrow function / callback body.
    headersFn?: () => HeadersInit;
    // Arrow function / callback body.
    beforeAttempt?: () => void;
  // Assign value for subsequent use.
  } = {},
// Open multi-line construct.
): Promise<unknown> {
  // Injectable deps keep unit tests free of real network / cookie state.
  const fetchFn = deps.fetchFn ?? fetchWithTimeout;
  // Local constant binding.
  const headersFn = deps.headersFn ?? authHeader;
  // Local constant binding.
  const refreshFn = deps.refreshFn ?? refreshAccessToken;

  // Rebuild headers on each attempt so post-refresh CSRF is current.
  const res = await fetchWithAuthRetry(
    // Arrow function / callback body.
    () =>
      // Open multi-line construct.
      fetchFn(url, {
        // Field/property in this shape.
        method: "POST",
        // Field/property in this shape.
        credentials: "include",
        // Field/property in this shape.
        headers: headersFn(),
        // Field/property in this shape.
        body: JSON.stringify(body),
      }),
    // Continue multi-line list/arguments.
    { refreshFn, beforeAttempt: deps.beforeAttempt },
  );

  // Local constant binding.
  const data = await res.json().catch(() => ({}));
  // Conditional branch for this case.
  if (!res.ok) {
    // Attach status/code/details so drain can classify conflict vs failed.
    const message =
      // Invoke helper or pass arguments.
      (data as { message?: string; error?: string }).message ??
      // Invoke helper or pass arguments.
      (data as { error?: string }).error ??
      // Continue module logic.
      `HTTP ${res.status}`;
    // Local constant binding.
    const err = new Error(message) as Error & {
      // Field/property in this shape.
      status?: number;
      // Field/property in this shape.
      code?: string;
      // Field/property in this shape.
      details?: unknown;
    };
    // Assign value for subsequent use.
    err.status = res.status;
    // Assign value for subsequent use.
    err.code = (data as { error?: string }).error;
    // Assign value for subsequent use.
    err.details = (data as { details?: unknown }).details;
    // Abort with an error for the caller.
    throw err;
  }
  // Successful I/O clears the unreachable latch for the banner.
  markReachable();
  // Return computed result to caller.
  return data;
}

/** Convenience alias used by drain and run-or-enqueue paths. */
export async function postJson(url: string, body: Record<string, unknown>) {
  // Return computed result to caller.
  return postJsonWithSessionRefresh(url, body);
}
