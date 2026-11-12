/**
 * Pure session / offline wipe policy (unit-testable, no I/O).
 *
 * Distinguishes hard auth loss from transient failures so bootstrap can keep
 * the IndexedDB outbox when the network or refresh is merely unavailable.
 */

export type RefreshOutcome = "refreshed" | "rejected" | "transient";

// Export type alias for consumers.
export type BootstrapFailureKind =
  // Union/intersection type member.
  | "network"
  // Union/intersection type member.
  | "auth_rejected"
  // Union/intersection type member.
  | "transient_http"
  // Union/intersection type member.
  | "unverified_401";

// Export type alias for consumers.
export type BootstrapFailure = {
  // Field/property in this shape.
  kind: BootstrapFailureKind;
  // Field/property in this shape.
  status?: number;
};

/** HTTP statuses that mean temporary unavailability, not identity loss. */
export function isTransientStatus(status: number): boolean {
  // Timeout, rate-limit, and 5xx keep the outbox; 4xx auth does not.
  return status === 408 || status === 429 || status >= 500;
}

/** Classify a failed /auth/refresh response (or transport failure). */
export function classifyRefreshFailure(
  // Field/property in this shape.
  statusOrNetwork: number | "network",
// Open multi-line construct.
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
  // Field/property in this shape.
  hasCachedUser: boolean;
  // Field/property in this shape.
  failure: BootstrapFailure;
// Open multi-line construct.
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
  // Conditional branch for this case.
  if (err && typeof err === "object") {
    // Local constant binding.
    const e = err as {
      // Field/property in this shape.
      kind?: string;
      // Field/property in this shape.
      status?: number;
      // Field/property in this shape.
      authRejected?: boolean;
      // Field/property in this shape.
      refreshOutcome?: RefreshOutcome;
    };
    // Prefer explicit authRejected / refreshOutcome from ApiRequestError.
    if (e.authRejected === true || e.refreshOutcome === "rejected") {
      // Return computed result to caller.
      return { kind: "auth_rejected", status: e.status };
    }
    // Conditional branch for this case.
    if (e.kind === "network") {
      // Return computed result to caller.
      return { kind: "network" };
    }
    // Conditional branch for this case.
    if (typeof e.status === "number") {
      // Conditional branch for this case.
      if (e.status === 401 || e.status === 403) {
        // 401 after refresh was unreachable/5xx — identity pending verification
        if (e.refreshOutcome === "transient") {
          // Return computed result to caller.
          return { kind: "unverified_401", status: e.status };
        }
        // Return computed result to caller.
        return { kind: "auth_rejected", status: e.status };
      }
      // Conditional branch for this case.
      if (isTransientStatus(e.status)) {
        // Return computed result to caller.
        return { kind: "transient_http", status: e.status };
      }
    }
  }
  // Unknown / plain Error (e.g. TypeError from fetch) → treat as network
  return { kind: "network" };
}
