import {
  classifyRefreshFailure,
  type RefreshOutcome,
} from "./sessionPolicy";
import type { AuthUser } from "./capabilities";

export type { RefreshOutcome };

export const API_BASE =
  (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  "/api";

type ApiError = {
  error?: string;
  message?: string;
};

export class ApiRequestError extends Error {
  readonly kind: "http" | "network";
  readonly status?: number;
  /** Set when a 401 triggered /auth/refresh during this request. */
  refreshOutcome?: RefreshOutcome;
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

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function buildAuthHeaders(method = "GET"): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS") {
    const csrf = getCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }
  return headers;
}

export function authHeaders(method = "GET"): HeadersInit {
  return buildAuthHeaders(method);
}

export async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as ApiError;
    const message = body.message ?? body.error ?? `HTTP ${res.status}`;
    const err = new ApiRequestError(message, {
      kind: "http",
      status: res.status,
    });
    if (res.status === 401 || res.status === 403) {
      if (lastRefreshOutcome) {
        err.refreshOutcome = lastRefreshOutcome;
        err.authRejected = lastRefreshOutcome === "rejected";
      } else {
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

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  // Best-effort: drop private IndexedDB + leftover authenticated HTTP caches
  // so a shared device cannot surface the previous user's offline data.
  void import("../offline").then((m) => {
    m.clearPrivateOfflineState();
  });
}

/** @deprecated Use clearSession */
export function clearToken() {
  clearSession();
}

/** @deprecated Tokens are httpOnly cookies — always null in JS. */
export function getToken(): string | null {
  return null;
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

export async function refreshAccessToken(): Promise<RefreshOutcome> {
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
  if (options?.skipRefresh || res.status !== 401) return res;
  const outcome = await (options?.refreshFn ?? refreshAccessToken)();
  if (outcome !== "refreshed") return res;
  return attempt();
}

/** Cookie-session fetch with CSRF and single-flight refresh on 401. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
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
      throw new ApiRequestError("Network error", { kind: "network", cause });
    }
  };
  return fetchWithAuthRetry(attempt, { skipRefresh: shouldSkipRefresh(url) });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    clearSession();
  }
}

export async function logoutAll(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/auth/logout-all`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    clearSession();
  }
}

export async function login(email: string, password: string) {
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
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  const user = await parseJson<AuthUser>(res);
  localStorage.setItem("user", JSON.stringify(user));
  return user;
}
