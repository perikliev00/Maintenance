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
  // Continue module logic.
  "/api";

type ApiError = {
  error?: string;
  message?: string;
  details?: unknown;
  existingTicket?: unknown;
  match?: unknown;
  suggestReopenTicketId?: unknown;
};

/** Thrown by `parseJson` / `apiFetch` so callers can distinguish HTTP vs network. */
export class ApiRequestError extends Error {
  // Readonly field on this type/class.
  readonly kind: "http" | "network";
  // Readonly field on this type/class.
  readonly status?: number;
  /** Machine-readable API error code (e.g. duplicate_active). */
  readonly code?: string;
  /** Structured error details from the API body. */
  readonly details?: unknown;
  /** Set when a 401 triggered /auth/refresh during this request. */
  refreshOutcome?: RefreshOutcome;
  /** True when identity is lost (refresh rejected, or 401/403 with no refresh context). */
  authRejected?: boolean;

  // Construct instance and assign fields.
  constructor(
    message: string,
    opts: {
      kind: "http" | "network";
      status?: number;
      code?: string;
      details?: unknown;
      refreshOutcome?: RefreshOutcome;
      authRejected?: boolean;
      cause?: unknown;
    },
  ) {
    // Invoke parent constructor/method.
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    // Update or read instance state.
    this.name = "ApiRequestError";
    // Update or read instance state.
    this.kind = opts.kind;
    // Update or read instance state.
    this.status = opts.status;
    // Update or read instance state.
    this.code = opts.code;
    // Update or read instance state.
    this.details = opts.details;
    // Update or read instance state.
    this.refreshOutcome = opts.refreshOutcome;
    // Update or read instance state.
    this.authRejected = opts.authRejected;
  }
}

/** Last /auth/refresh outcome (for attaching to subsequent 401 parse errors). */
let lastRefreshOutcome: RefreshOutcome | null = null;
let sessionRevision = 0;
let sessionChangesPending = 0;

// Function definition.
function beginSessionChange() {
  // Continue module logic.
  sessionRevision++;
  // Continue module logic.
  sessionChangesPending++;
  lastRefreshOutcome = null;
}

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
    // Prefer nested details; duplicate payloads may also be top-level.
    const details =
      // Continue module logic.
      body.details ??
      // Continue module logic.
      (body.existingTicket || body.match
        ? {
            existingTicket: body.existingTicket,
            match: body.match,
            suggestReopenTicketId: body.suggestReopenTicketId,
          }
        // Continue module logic.
        : undefined);
    const err = new ApiRequestError(message, {
      kind: "http",
      status: res.status,
      code: typeof body.error === "string" ? body.error : undefined,
      details,
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
    // Abort with an error for the caller.
    throw err;
  }
  return data as T;
}

// Exported function entry point.
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  // Iterate collection / range.
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// Exported async function entry point.
export async function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson<T>(res);
}

// Exported async function entry point.
export async function apiPost<T>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders("POST"),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: init?.signal,
  });
  return parseJson<T>(res);
}

// Exported async function entry point.
export async function apiPatch<T>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: authHeaders("PATCH"),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: init?.signal,
  });
  return parseJson<T>(res);
}

// Exported async function entry point.
export async function apiDelete<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders("DELETE"),
    signal: init?.signal,
  });
  return parseJson<T>(res);
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
  const revision = sessionRevision;
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  const m = await import("../offline/session");
  if (revision !== sessionRevision) return;
  m.clearPrivateOfflineState();
  await m.whenOfflineUserSettled();
}

/**
 * Drop local identity cache and private offline state (fire-and-forget).
 * Prefer {@link logout} / {@link logoutAll}, which await the wipe.
 * Legacy `token` / `refreshToken` keys are removed for older installs; auth is cookie-based.
 */
export function clearSession() {
  const previousRefresh = refreshInFlight;
  beginSessionChange();
  // Fire-and-forget async/side effect.
  void Promise.all([wipeLocalSession(), previousRefresh]).finally(() => { sessionChangesPending--; });
}

/** Coalesce concurrent 401s into one refresh so the outbox does not stampede. */
let refreshInFlight: Promise<RefreshOutcome> | null = null;
let authChangeInFlight: Promise<void> = Promise.resolve();

/** Serialize cookie-changing login/logout responses, including a queued login. */
function withSessionChange<T>(action: () => Promise<T>): Promise<T> {
  const previousRefresh = refreshInFlight;
  beginSessionChange();
  const task = authChangeInFlight.then(async () => {
    await previousRefresh;
    return action();
  });
  authChangeInFlight = task.then(() => undefined, () => undefined);
  return task.finally(() => { sessionChangesPending--; });
}

/**
 * Rotate the cookie session via POST /auth/refresh.
 * Rejected → wipe session; network/5xx → `"transient"` so offline work is kept.
 */
export async function refreshAccessToken(): Promise<RefreshOutcome> {
  // Do not start another cookie rotation while login/logout waits for the
  // preceding rotation; that would recreate the stale Set-Cookie race.
  if (sessionChangesPending > 0) return "rejected";
  // Single-flight: concurrent 401s share one refresh promise.
  if (refreshInFlight) return refreshInFlight;
  const revision = sessionRevision;
  // Const arrow/function binding.
  const pending = (async (): Promise<RefreshOutcome> => {
    // Guard fallible work.
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: buildAuthHeaders("POST"),
      });
      if (revision !== sessionRevision) return "rejected";
      if (res.ok) {
        lastRefreshOutcome = "refreshed";
        return "refreshed";
      }
      // Map status → rejected (wipe) vs transient (keep outbox).
      const classified = classifyRefreshFailure(res.status);
      lastRefreshOutcome = classified;
      if (classified === "rejected") {
        await wipeLocalSession();
      }
      return classified;
    } catch {
      if (revision !== sessionRevision) return "rejected";
      lastRefreshOutcome = "transient";
      // Network/timeout — keep offline outbox; identity pending verification.
      return "transient";
    } finally {
      refreshInFlight = null;
    }
  // Invoke helper or pass arguments.
  })();
  refreshInFlight = pending;
  return pending;
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
    /** Synchronous identity guard, checked before every send and refresh. */
    beforeAttempt?: () => void;
  },
): Promise<Response> {
  options?.beforeAttempt?.();
  const res = await attempt();
  // Auth endpoints and non-401 responses skip the refresh path.
  if (options?.skipRefresh || res.status !== 401) return res;
  options?.beforeAttempt?.();
  const outcome = await (options?.refreshFn ?? refreshAccessToken)();
  // Only a successful rotation retries; rejected/transient return the original 401.
  if (outcome !== "refreshed") return res;
  // Rebuild headers inside `attempt` so CSRF is current after Set-Cookie.
  options?.beforeAttempt?.();
  return attempt();
}

/** Cookie-session fetch with CSRF and single-flight refresh on 401. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // Const arrow/function binding.
  const method = (init.method ?? "GET").toUpperCase();
  // Closure rebuilds CSRF headers on each attempt (including post-refresh retry).
  const attempt = async () => {
    const headers = new Headers(init.headers);
    const rebuilt = buildAuthHeaders(method);
    // Iterate collection / range.
    for (const [key, value] of Object.entries(rebuilt)) {
      // A caller may have captured authHeaders before refresh. CSRF always
      // comes from the current cookie; other explicit headers stay intact.
      if (key === "X-CSRF-Token" || !headers.has(key)) headers.set(key, value);
    }
    // Guard fallible work.
    try {
      return await fetch(url, {
        // Spread remaining fields/props.
        ...init,
        headers,
        credentials: "include",
      });
    // Invoke helper or pass arguments.
    } catch (cause) {
      // Fetch threw (offline / DNS) — distinguish from HTTP error bodies.
      throw new ApiRequestError("Network error", { kind: "network", cause });
    }
  };
  return fetchWithAuthRetry(attempt, { skipRefresh: shouldSkipRefresh(url) });
}

/** End this browser's session; always clears local + offline state afterward. */
export async function logout(): Promise<void> {
  return withSessionChange(async () => { try {
    // Best-effort server revoke; local wipe always runs in finally.
    await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    // Await purge so the Sign-in screen is only shown after outbox wipe settles.
    await wipeLocalSession();
  } });
}

/** Revoke all devices' sessions, then clear local + offline state. */
export async function logoutAll(): Promise<void> {
  return withSessionChange(async () => { try {
    const res = await apiFetch(`${API_BASE}/auth/logout-all`, { method: "POST" });
    const result = await parseJson<{ ok?: boolean; revoked?: number }>(res);
    if (result.ok !== true || typeof result.revoked !== "number") {
      // Abort with an error for the caller.
      throw new Error("The server did not confirm revoking all sessions");
    }
  // Invoke helper or pass arguments.
  } catch (error) {
    // Drop this browser's httpOnly cookies even when global revoke failed.
    // The queue keeps any subsequent login behind this response.
    try { await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" }); } catch { /* best effort */ }
    // Abort with an error for the caller.
    throw error;
  } finally {
    await wipeLocalSession();
  } });
}

/**
 * Password login (no prior CSRF required). Persists a non-secret user cache;
 * session cookies come from the response `Set-Cookie`.
 */
export async function login(email: string, password: string) {
  return withSessionChange(async () => {
    // Raw fetch (not apiFetch) — no prior CSRF; skip refresh loop on login.
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: buildAuthHeaders("POST"),
      body: JSON.stringify({ email, password }),
    });
    const data = await parseJson<{
      user: AuthUser;
      expiresIn?: number;
    // Invoke helper or pass arguments.
    }>(res);
    // Non-secret UI cache; real session lives in HttpOnly cookies.
    localStorage.setItem("user", JSON.stringify(data.user));
    // Retire in-flight fetchMe calls that started during this login under the
    // same revision. Otherwise a stale /me body (prior cookie) can land after
    // pending drops to 0 and overwrite the new cache while cookies are already B.
    sessionRevision++;
    return data;
  });
}

/** Refresh capabilities/panels from the server and update the local user cache. */
export async function fetchMe(): Promise<AuthUser> {
  const revision = sessionRevision;
  const res = await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  const user = await parseJson<AuthUser>(res);
  if (revision !== sessionRevision || sessionChangesPending > 0) {
    // Abort with an error for the caller.
    throw new ApiRequestError("Account changed while loading profile", { kind: "network", authRejected: false });
  }
  // Keep local cache aligned with server capability grants.
  localStorage.setItem("user", JSON.stringify(user));
  return user;
}
