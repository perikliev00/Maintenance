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
  // List item in import/export/params.
  classifyRefreshFailure,
  // Local type alias shaping data.
  type RefreshOutcome,
// Close multi-line construct with trailing syntax.
} from "./sessionPolicy";
// Import dependency used by this module.
import type { AuthUser } from "./capabilities";

// Export type alias for consumers.
export type { RefreshOutcome };

/** API origin; defaults to same-origin `/api` when `VITE_API_URL` is unset. */
export const API_BASE =
  // Invoke helper or pass arguments.
  (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  // Continue module logic.
  "/api";

// Local type alias shaping data.
type ApiError = {
  // Field/property in this shape.
  error?: string;
  // Field/property in this shape.
  message?: string;
  // Field/property in this shape.
  details?: unknown;
  // Field/property in this shape.
  existingTicket?: unknown;
  // Field/property in this shape.
  match?: unknown;
  // Field/property in this shape.
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
    // Field/property in this shape.
    message: string,
    // Field/property in this shape.
    opts: {
      // Field/property in this shape.
      kind: "http" | "network";
      // Field/property in this shape.
      status?: number;
      // Field/property in this shape.
      code?: string;
      // Field/property in this shape.
      details?: unknown;
      // Field/property in this shape.
      refreshOutcome?: RefreshOutcome;
      // Field/property in this shape.
      authRejected?: boolean;
      // Field/property in this shape.
      cause?: unknown;
    },
  // Open multi-line construct.
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
// Mutable local binding.
let sessionRevision = 0;
// Mutable local binding.
let sessionChangesPending = 0;

// Function definition.
function beginSessionChange() {
  // Continue module logic.
  sessionRevision++;
  // Continue module logic.
  sessionChangesPending++;
  // Assign value for subsequent use.
  lastRefreshOutcome = null;
}

/** Read the double-submit CSRF cookie set by the API (not HttpOnly so JS can send it). */
function getCsrfToken(): string | null {
  // SSR / non-DOM: no cookies available.
  if (typeof document === "undefined") return null;
  // Match the non-HttpOnly `csrf` cookie the API sets for double-submit.
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  // Return computed result to caller.
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * JSON Content-Type plus CSRF on unsafe methods. Safe methods omit the token
 * so GETs stay cache-friendly and do not need a cookie round-trip.
 */
function buildAuthHeaders(method = "GET"): Record<string, string> {
  // Local constant binding.
  const headers: Record<string, string> = {
    // Continue multi-line list/arguments.
    "Content-Type": "application/json",
  };
  // Local constant binding.
  const upper = method.toUpperCase();
  // Safe methods omit CSRF so GETs stay cache-friendly.
  if (upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS") {
    // Local constant binding.
    const csrf = getCsrfToken();
    // Cookie may be missing on first paint before Set-Cookie lands.
    if (csrf) {
      // Assign value for subsequent use.
      headers["X-CSRF-Token"] = csrf;
    }
  }
  // Return computed result to caller.
  return headers;
}

/** Public wrapper for callers that build their own `fetch` / `apiFetch` init. */
export function authHeaders(method = "GET"): HeadersInit {
  // Return computed result to caller.
  return buildAuthHeaders(method);
}

/**
 * Parse JSON body; on non-OK attach `refreshOutcome` / `authRejected` from the
 * last refresh so bootstrap can decide whether to wipe the offline outbox.
 */
export async function parseJson<T>(res: Response): Promise<T> {
  // Tolerate empty / non-JSON error bodies.
  const data = await res.json().catch(() => ({}));
  // Conditional branch for this case.
  if (!res.ok) {
    // Local constant binding.
    const body = data as ApiError;
    // Local constant binding.
    const message = body.message ?? body.error ?? `HTTP ${res.status}`;
    // Prefer nested details; duplicate payloads may also be top-level.
    const details =
      // Continue module logic.
      body.details ??
      // Continue module logic.
      (body.existingTicket || body.match
        // Open multi-line construct.
        ? {
            // Field/property in this shape.
            existingTicket: body.existingTicket,
            // Field/property in this shape.
            match: body.match,
            // Field/property in this shape.
            suggestReopenTicketId: body.suggestReopenTicketId,
          }
        // Continue module logic.
        : undefined);
    // Local constant binding.
    const err = new ApiRequestError(message, {
      // Field/property in this shape.
      kind: "http",
      // Field/property in this shape.
      status: res.status,
      // Field/property in this shape.
      code: typeof body.error === "string" ? body.error : undefined,
      // List item in import/export/params.
      details,
    });
    // Attach last refresh outcome so bootstrap can decide outbox wipe vs keep.
    if (res.status === 401 || res.status === 403) {
      // Conditional branch for this case.
      if (lastRefreshOutcome) {
        // Assign value for subsequent use.
        err.refreshOutcome = lastRefreshOutcome;
        // Assign value for subsequent use.
        err.authRejected = lastRefreshOutcome === "rejected";
      // Open multi-line construct.
      } else {
        // No refresh ran (e.g. skipRefresh) — treat as hard auth loss.
        err.authRejected = true;
      }
    }
    // Abort with an error for the caller.
    throw err;
  }
  // Return computed result to caller.
  return data as T;
}

// Exported function entry point.
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  // Local constant binding.
  const search = new URLSearchParams();
  // Iterate collection / range.
  for (const [k, v] of Object.entries(params)) {
    // Conditional branch for this case.
    if (v === undefined || v === null || v === "") continue;
    // Invoke helper or pass arguments.
    search.set(k, String(v));
  }
  // Local constant binding.
  const qs = search.toString();
  // Return computed result to caller.
  return qs ? `?${qs}` : "";
}

// Exported async function entry point.
export async function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}${path}`, {
    // Field/property in this shape.
    headers: authHeaders(),
    // Field/property in this shape.
    signal: init?.signal,
  });
  // Return computed result to caller.
  return parseJson<T>(res);
}

// Exported async function entry point.
export async function apiPost<T>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}${path}`, {
    // Field/property in this shape.
    method: "POST",
    // Field/property in this shape.
    headers: authHeaders("POST"),
    // Field/property in this shape.
    body: body === undefined ? undefined : JSON.stringify(body),
    // Field/property in this shape.
    signal: init?.signal,
  });
  // Return computed result to caller.
  return parseJson<T>(res);
}

// Exported async function entry point.
export async function apiPatch<T>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}${path}`, {
    // Field/property in this shape.
    method: "PATCH",
    // Field/property in this shape.
    headers: authHeaders("PATCH"),
    // Field/property in this shape.
    body: body === undefined ? undefined : JSON.stringify(body),
    // Field/property in this shape.
    signal: init?.signal,
  });
  // Return computed result to caller.
  return parseJson<T>(res);
}

// Exported async function entry point.
export async function apiDelete<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}${path}`, {
    // Field/property in this shape.
    method: "DELETE",
    // Field/property in this shape.
    headers: authHeaders("DELETE"),
    // Field/property in this shape.
    signal: init?.signal,
  });
  // Return computed result to caller.
  return parseJson<T>(res);
}

/** True when a non-secret user cache exists (cookie session may still be valid). */
export function hasCachedSession(): boolean {
  // Return computed result to caller.
  return getStoredUser() !== null;
}

/** Non-secret user snapshot for UI bootstrap; cookies hold the real session. */
export function getStoredUser(): AuthUser | null {
  // Local constant binding.
  const raw = localStorage.getItem("user");
  // Conditional branch for this case.
  if (!raw) return null;
  // Corrupt cache must not break bootstrap — treat as logged out.
  try {
    // Return computed result to caller.
    return JSON.parse(raw) as AuthUser;
  // Open multi-line construct.
  } catch {
    // Return computed result to caller.
    return null;
  }
}

/**
 * Drop local identity cache and await private offline purge.
 * Shared-device logout must finish wiping IndexedDB before the login screen is
 * usable, otherwise the next profile can observe the prior user's outbox.
 */
async function wipeLocalSession(): Promise<void> {
  // Local constant binding.
  const revision = sessionRevision;
  // Invoke helper or pass arguments.
  localStorage.removeItem("token");
  // Invoke helper or pass arguments.
  localStorage.removeItem("refreshToken");
  // Invoke helper or pass arguments.
  localStorage.removeItem("user");
  // Local constant binding.
  const m = await import("../offline/session");
  // Conditional branch for this case.
  if (revision !== sessionRevision) return;
  // Invoke helper or pass arguments.
  m.clearPrivateOfflineState();
  // Await async work before continuing.
  await m.whenOfflineUserSettled();
}

/**
 * Drop local identity cache and private offline state (fire-and-forget).
 * Prefer {@link logout} / {@link logoutAll}, which await the wipe.
 * Legacy `token` / `refreshToken` keys are removed for older installs; auth is cookie-based.
 */
export function clearSession() {
  // Local constant binding.
  const previousRefresh = refreshInFlight;
  // Invoke helper or pass arguments.
  beginSessionChange();
  // Fire-and-forget async/side effect.
  void Promise.all([wipeLocalSession(), previousRefresh]).finally(() => { sessionChangesPending--; });
}

/** Coalesce concurrent 401s into one refresh so the outbox does not stampede. */
let refreshInFlight: Promise<RefreshOutcome> | null = null;
// Mutable local binding.
let authChangeInFlight: Promise<void> = Promise.resolve();

/** Serialize cookie-changing login/logout responses, including a queued login. */
function withSessionChange<T>(action: () => Promise<T>): Promise<T> {
  // Local constant binding.
  const previousRefresh = refreshInFlight;
  // Invoke helper or pass arguments.
  beginSessionChange();
  // Local constant binding.
  const task = authChangeInFlight.then(async () => {
    // Await async work before continuing.
    await previousRefresh;
    // Return computed result to caller.
    return action();
  });
  // Arrow function / callback body.
  authChangeInFlight = task.then(() => undefined, () => undefined);
  // Return computed result to caller.
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
  // Local constant binding.
  const revision = sessionRevision;
  // Const arrow/function binding.
  const pending = (async (): Promise<RefreshOutcome> => {
    // Guard fallible work.
    try {
      // Local constant binding.
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        // Field/property in this shape.
        method: "POST",
        // Field/property in this shape.
        credentials: "include",
        // Field/property in this shape.
        headers: buildAuthHeaders("POST"),
      });
      // Conditional branch for this case.
      if (revision !== sessionRevision) return "rejected";
      // Conditional branch for this case.
      if (res.ok) {
        // Assign value for subsequent use.
        lastRefreshOutcome = "refreshed";
        // Return computed result to caller.
        return "refreshed";
      }
      // Map status → rejected (wipe) vs transient (keep outbox).
      const classified = classifyRefreshFailure(res.status);
      // Assign value for subsequent use.
      lastRefreshOutcome = classified;
      // Conditional branch for this case.
      if (classified === "rejected") {
        // Await async work before continuing.
        await wipeLocalSession();
      }
      // Return computed result to caller.
      return classified;
    // Open multi-line construct.
    } catch {
      // Conditional branch for this case.
      if (revision !== sessionRevision) return "rejected";
      // Assign value for subsequent use.
      lastRefreshOutcome = "transient";
      // Network/timeout — keep offline outbox; identity pending verification.
      return "transient";
    // Open multi-line construct.
    } finally {
      // Assign value for subsequent use.
      refreshInFlight = null;
    }
  // Invoke helper or pass arguments.
  })();
  // Assign value for subsequent use.
  refreshInFlight = pending;
  // Return computed result to caller.
  return pending;
}

/** Avoid refresh loops on auth endpoints that themselves establish or end the session. */
function shouldSkipRefresh(url: string): boolean {
  // Return computed result to caller.
  return (
    // Invoke helper or pass arguments.
    url.includes("/auth/login") ||
    // Invoke helper or pass arguments.
    url.includes("/auth/refresh") ||
    // Invoke helper or pass arguments.
    url.includes("/auth/logout")
  );
}

/**
 * One attempt, then a single retry after a successful refresh on 401.
 * `attempt` must rebuild headers so the retry sends a fresh CSRF token.
 */
export async function fetchWithAuthRetry(
  // Arrow function / callback body.
  attempt: () => Promise<Response>,
  // Field/property in this shape.
  options?: {
    // Arrow function / callback body.
    refreshFn?: () => Promise<RefreshOutcome>;
    // Field/property in this shape.
    skipRefresh?: boolean;
    /** Synchronous identity guard, checked before every send and refresh. */
    beforeAttempt?: () => void;
  },
// Open multi-line construct.
): Promise<Response> {
  // Invoke helper or pass arguments.
  options?.beforeAttempt?.();
  // Local constant binding.
  const res = await attempt();
  // Auth endpoints and non-401 responses skip the refresh path.
  if (options?.skipRefresh || res.status !== 401) return res;
  // Invoke helper or pass arguments.
  options?.beforeAttempt?.();
  // Local constant binding.
  const outcome = await (options?.refreshFn ?? refreshAccessToken)();
  // Only a successful rotation retries; rejected/transient return the original 401.
  if (outcome !== "refreshed") return res;
  // Rebuild headers inside `attempt` so CSRF is current after Set-Cookie.
  options?.beforeAttempt?.();
  // Return computed result to caller.
  return attempt();
}

/** Cookie-session fetch with CSRF and single-flight refresh on 401. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // Const arrow/function binding.
  const method = (init.method ?? "GET").toUpperCase();
  // Closure rebuilds CSRF headers on each attempt (including post-refresh retry).
  const attempt = async () => {
    // Local constant binding.
    const headers = new Headers(init.headers);
    // Local constant binding.
    const rebuilt = buildAuthHeaders(method);
    // Iterate collection / range.
    for (const [key, value] of Object.entries(rebuilt)) {
      // A caller may have captured authHeaders before refresh. CSRF always
      // comes from the current cookie; other explicit headers stay intact.
      if (key === "X-CSRF-Token" || !headers.has(key)) headers.set(key, value);
    }
    // Guard fallible work.
    try {
      // Return computed result to caller.
      return await fetch(url, {
        // Spread remaining fields/props.
        ...init,
        // List item in import/export/params.
        headers,
        // Field/property in this shape.
        credentials: "include",
      });
    // Invoke helper or pass arguments.
    } catch (cause) {
      // Fetch threw (offline / DNS) — distinguish from HTTP error bodies.
      throw new ApiRequestError("Network error", { kind: "network", cause });
    }
  };
  // Return computed result to caller.
  return fetchWithAuthRetry(attempt, { skipRefresh: shouldSkipRefresh(url) });
}

/** End this browser's session; always clears local + offline state afterward. */
export async function logout(): Promise<void> {
  // Return computed result to caller.
  return withSessionChange(async () => { try {
    // Best-effort server revoke; local wipe always runs in finally.
    await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  // Open multi-line construct.
  } catch {
    /* best-effort */
  } finally {
    // Await purge so the Sign-in screen is only shown after outbox wipe settles.
    await wipeLocalSession();
  // Close multi-line construct with trailing syntax.
  } });
}

/** Revoke all devices' sessions, then clear local + offline state. */
export async function logoutAll(): Promise<void> {
  // Return computed result to caller.
  return withSessionChange(async () => { try {
    // Local constant binding.
    const res = await apiFetch(`${API_BASE}/auth/logout-all`, { method: "POST" });
    // Local constant binding.
    const result = await parseJson<{ ok?: boolean; revoked?: number }>(res);
    // Conditional branch for this case.
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
  // Open multi-line construct.
  } finally {
    // Await async work before continuing.
    await wipeLocalSession();
  // Close multi-line construct with trailing syntax.
  } });
}

/**
 * Password login (no prior CSRF required). Persists a non-secret user cache;
 * session cookies come from the response `Set-Cookie`.
 */
export async function login(email: string, password: string) {
  // Return computed result to caller.
  return withSessionChange(async () => {
    // Raw fetch (not apiFetch) — no prior CSRF; skip refresh loop on login.
    const res = await fetch(`${API_BASE}/auth/login`, {
      // Field/property in this shape.
      method: "POST",
      // Field/property in this shape.
      credentials: "include",
      // Field/property in this shape.
      headers: buildAuthHeaders("POST"),
      // Field/property in this shape.
      body: JSON.stringify({ email, password }),
    });
    // Local constant binding.
    const data = await parseJson<{
      // Field/property in this shape.
      user: AuthUser;
      // Field/property in this shape.
      expiresIn?: number;
    // Invoke helper or pass arguments.
    }>(res);
    // Non-secret UI cache; real session lives in HttpOnly cookies.
    localStorage.setItem("user", JSON.stringify(data.user));
    // Retire in-flight fetchMe calls that started during this login under the
    // same revision. Otherwise a stale /me body (prior cookie) can land after
    // pending drops to 0 and overwrite the new cache while cookies are already B.
    sessionRevision++;
    // Return computed result to caller.
    return data;
  });
}

/** Refresh capabilities/panels from the server and update the local user cache. */
export async function fetchMe(): Promise<AuthUser> {
  // Local constant binding.
  const revision = sessionRevision;
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  // Local constant binding.
  const user = await parseJson<AuthUser>(res);
  // Conditional branch for this case.
  if (revision !== sessionRevision || sessionChangesPending > 0) {
    // Abort with an error for the caller.
    throw new ApiRequestError("Account changed while loading profile", { kind: "network", authRejected: false });
  }
  // Keep local cache aligned with server capability grants.
  localStorage.setItem("user", JSON.stringify(user));
  // Return computed result to caller.
  return user;
}
