/**
 * Pure session / offline wipe policy (unit-testable, no I/O).
 *
 * Distinguishes hard auth loss from transient failures so bootstrap can keep
 * the IndexedDB outbox when the network or refresh is merely unavailable.
 */

export type RefreshOutcome = "refreshed" | "rejected" | "transient";

export type BootstrapFailureKind =
  // Union/intersection type member.
  | "network"
  // Union/intersection type member.
  | "auth_rejected"
  // Union/intersection type member.
  | "transient_http"
  // Union/intersection type member.
  | "unverified_401";

export type BootstrapFailure = {
  kind: BootstrapFailureKind;
  status?: number;
};

/** HTTP statuses that mean temporary unavailability, not identity loss. */
export function isTransientStatus(status: number): boolean {
  // Timeout, rate-limit, and 5xx keep the outbox; 4xx auth does not.
  return status === 408 || status === 429 || status >= 500;
}

/** Classify a failed /auth/refresh response (or transport failure). */
export function classifyRefreshFailure(
  statusOrNetwork: number | "network",
): "rejected" | "transient" {
  // Transport failure — do not wipe identity or offline queue.
  if (statusOrNetwork === "network") return "transient";
  // Hard auth loss — session cookies invalid / forbidden.
  if (statusOrNetwork === 401 || statusOrNetwork === 403) return "rejected";
  // Other HTTP failures (5xx, 429, …) — retry later.
  return "transient";
}

/**
 * Whether bootstrap should call clearSession (wipes auth cache + offline outbox).
 * Explicit logout always wipes — that path does not use this helper.
 */
export function shouldWipeOfflineOnBootstrap(input: {
  hasCachedUser: boolean;
  failure: BootstrapFailure;
}): boolean {
  // No cached identity → nothing private to preserve; wipe leftovers.
  if (!input.hasCachedUser) return true;
  // Explicit auth rejection → wipe outbox so the next user cannot see it.
  if (input.failure.kind === "auth_rejected") return true;
  // network, transient_http, unverified_401: keep outbox + cached identity
  return false;
}

/** Map a thrown API error into a bootstrap failure classification. */
export function classifyBootstrapError(err: unknown): BootstrapFailure {
  if (err && typeof err === "object") {
    const e = err as {
      kind?: string;
      status?: number;
      authRejected?: boolean;
      refreshOutcome?: RefreshOutcome;
    };
    // Prefer explicit authRejected / refreshOutcome from ApiRequestError.
    if (e.authRejected === true || e.refreshOutcome === "rejected") {
      return { kind: "auth_rejected", status: e.status };
    }
    if (e.kind === "network") {
      return { kind: "network" };
    }
    if (typeof e.status === "number") {
      if (e.status === 401 || e.status === 403) {
        // 401 after refresh was unreachable/5xx — identity pending verification
        if (e.refreshOutcome === "transient") {
          return { kind: "unverified_401", status: e.status };
        }
        return { kind: "auth_rejected", status: e.status };
      }
      if (isTransientStatus(e.status)) {
        return { kind: "transient_http", status: e.status };
      }
    }
  }
  // Unknown / plain Error (e.g. TypeError from fetch) → treat as network
  return { kind: "network" };
}
