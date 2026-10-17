/**
 * Cookie-session HTTP transport for the Meridian web app.
 *
 * Auth is cookie-based (`credentials: "include"`). Mutating requests also send
 * `X-CSRF-Token` from the non-HttpOnly `csrf` cookie. On 401, a single-flight
 * `/auth/refresh` runs once; only `"refreshed"` retries the original attempt
 * (with rebuilt headers so CSRF stays current). `"rejected"` clears the local
 * session + offline outbox; `"transient"` keeps both for offline recovery.
 */
import {
  classifyRefreshFailure,
  type RefreshOutcome,
} from "./sessionPolicy";
import type { AuthUser } from "./capabilities";

export type { RefreshOutcome };

/** API origin; defaults to same-origin `/api` when `VITE_API_URL` is unset. */
export const API_BASE =
  (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  "/api";

type ApiError = {
  error?: string;
  message?: string;
};

/** Thrown by `parseJson` / `apiFetch` so callers can distinguish HTTP vs network. */
export class ApiRequestError extends Error {
  readonly kind: "http" | "network";
  readonly status?: number;
  /** Set when a 401 triggered /auth/refresh during this request. */
  refreshOutcome?: RefreshOutcome;
  /** True when identity is lost (refresh rejected, or 401/403 with no refresh context). */
  authRejected?: boolean;

  constructor(
    message: string,
    opts: {
      kind: "http" | "network";
      status?: number;
      refreshOutcome?: RefreshOutcome;
      authRejected?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ApiRequestError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.refreshOutcome = opts.refreshOutcome;
    this.authRejected = opts.authRejected;
  }
}

/** Last /auth/refresh outcome (for attaching to subsequent 401 parse errors). */
let lastRefreshOutcome: RefreshOutcome | null = null;

/** Read the double-submit CSRF cookie set by the API (not HttpOnly so JS can send it). */
function getCsrfToken(): string | null {
  // SSR / non-DOM: no cookies available.
  if (typeof document === "undefined") return null;
  // Match the non-HttpOnly `csrf` cookie the API sets for double-submit.
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * JSON Content-Type plus CSRF on unsafe methods. Safe methods omit the token
 * so GETs stay cache-friendly and do not need a cookie round-trip.
 */
function buildAuthHeaders(method = "GET"): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const upper = method.toUpperCase();
  // Safe methods omit CSRF so GETs stay cache-friendly.
  if (upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS") {
    const csrf = getCsrfToken();
    // Cookie may be missing on first paint before Set-Cookie lands.
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }
  return headers;
}

/** Public wrapper for callers that build their own `fetch` / `apiFetch` init. */
export function authHeaders(method = "GET"): HeadersInit {
  return buildAuthHeaders(method);
}

/**
 * Parse JSON body; on non-OK attach `refreshOutcome` / `authRejected` from the
 * last refresh so bootstrap can decide whether to wipe the offline outbox.
 */
export async function parseJson<T>(res: Response): Promise<T> {
  // Tolerate empty / non-JSON error bodies.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as ApiError;
    const message = body.message ?? body.error ?? `HTTP ${res.status}`;
    const err = new ApiRequestError(message, {
      kind: "http",
      status: res.status,
    });
    // Attach last refresh outcome so bootstrap can decide outbox wipe vs keep.
    if (res.status === 401 || res.status === 403) {
      if (lastRefreshOutcome) {
        err.refreshOutcome = lastRefreshOutcome;
        err.authRejected = lastRefreshOutcome === "rejected";
      } else {
        // No refresh ran (e.g. skipRefresh) — treat as hard auth loss.
        err.authRejected = true;
      }
    }
    throw err;
  }
  return data as T;
}

/** True when a non-secret user cache exists (cookie session may still be valid). */
export function hasCachedSession(): boolean {
  return getStoredUser() !== null;
}

/** Non-secret user snapshot for UI bootstrap; cookies hold the real session. */
export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  // Corrupt cache must not break bootstrap — treat as logged out.
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Drop local identity cache and await private offline purge.
 * Shared-device logout must finish wiping IndexedDB before the login screen is
 * usable, otherwise the next profile can observe the prior user's outbox.
 */
async function wipeLocalSession(): Promise<void> {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  const m = await import("../offline");
  m.clearPrivateOfflineState();
  await m.whenOfflineUserSettled();
}

/**
 * Drop local identity cache and private offline state (fire-and-forget).
 * Prefer {@link logout} / {@link logoutAll}, which await the wipe.
 * Legacy `token` / `refreshToken` keys are removed for older installs; auth is cookie-based.
 */
export function clearSession() {
  void wipeLocalSession();
}

/** Coalesce concurrent 401s into one refresh so the outbox does not stampede. */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * Rotate the cookie session via POST /auth/refresh.
 * Rejected → wipe session; network/5xx → `"transient"` so offline work is kept.
 */
export async function refreshAccessToken(): Promise<RefreshOutcome> {
  // Single-flight: concurrent 401s share one refresh promise.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: buildAuthHeaders("POST"),
      });
      if (res.ok) {
        lastRefreshOutcome = "refreshed";
        return "refreshed";
      }
      // Map status → rejected (wipe) vs transient (keep outbox).
      const classified = classifyRefreshFailure(res.status);
      lastRefreshOutcome = classified;
      if (classified === "rejected") {
        clearSession();
      }
      return classified;
    } catch {
      lastRefreshOutcome = "transient";
      // Network/timeout — keep offline outbox; identity pending verification.
      return "transient";
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Avoid refresh loops on auth endpoints that themselves establish or end the session. */
function shouldSkipRefresh(url: string): boolean {
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout")
  );
}

/**
 * One attempt, then a single retry after a successful refresh on 401.
 * `attempt` must rebuild headers so the retry sends a fresh CSRF token.
 */
export async function fetchWithAuthRetry(
  attempt: () => Promise<Response>,
  options?: {
    refreshFn?: () => Promise<RefreshOutcome>;
    skipRefresh?: boolean;
  },
): Promise<Response> {
  const res = await attempt();
  // Auth endpoints and non-401 responses skip the refresh path.
  if (options?.skipRefresh || res.status !== 401) return res;
  const outcome = await (options?.refreshFn ?? refreshAccessToken)();
  // Only a successful rotation retries; rejected/transient return the original 401.
  if (outcome !== "refreshed") return res;
  // Rebuild headers inside `attempt` so CSRF is current after Set-Cookie.
  return attempt();
}

/** Cookie-session fetch with CSRF and single-flight refresh on 401. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  // Closure rebuilds CSRF headers on each attempt (including post-refresh retry).
  const attempt = async () => {
    const headers: Record<string, string> = {
      ...buildAuthHeaders(method),
      ...(init.headers as Record<string, string> | undefined),
    };
    try {
      return await fetch(url, {
        ...init,
        headers,
        credentials: "include",
      });
    } catch (cause) {
      // Fetch threw (offline / DNS) — distinguish from HTTP error bodies.
      throw new ApiRequestError("Network error", { kind: "network", cause });
    }
  };
  return fetchWithAuthRetry(attempt, { skipRefresh: shouldSkipRefresh(url) });
}

/** End this browser's session; always clears local + offline state afterward. */
export async function logout(): Promise<void> {
  try {
    // Best-effort server revoke; local wipe always runs in finally.
    await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    // Await purge so the Sign-in screen is only shown after outbox wipe settles.
    await wipeLocalSession();
  }
}

/** Revoke all devices' sessions, then clear local + offline state. */
export async function logoutAll(): Promise<void> {
  try {
    // Best-effort server revoke-all; local wipe always runs in finally.
    await apiFetch(`${API_BASE}/auth/logout-all`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    await wipeLocalSession();
  }
}

/**
 * Password login (no prior CSRF required). Persists a non-secret user cache;
 * session cookies come from the response `Set-Cookie`.
 */
export async function login(email: string, password: string) {
  // Raw fetch (not apiFetch) — no prior CSRF; skip refresh loop on login.
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson<{
    user: AuthUser;
    expiresIn?: number;
  }>(res);
  // Non-secret UI cache; real session lives in HttpOnly cookies.
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

/** Refresh capabilities/panels from the server and update the local user cache. */
export async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  const user = await parseJson<AuthUser>(res);
  // Keep local cache aligned with server capability grants.
  localStorage.setItem("user", JSON.stringify(user));
  return user;
}
