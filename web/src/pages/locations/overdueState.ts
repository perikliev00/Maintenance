/**
 * Overdue-session load state for the Locations board.
 * Distinguishes empty success from failed fetches so the UI never claims
 * "no overdue" when the check did not complete.
 *
 * `hasSuccessfulLoad` survives loading transitions so a failed refresh can
 * keep the last successful payload (including an empty list) as stale.
 */
import type { OverdueSession } from "../../api/client";

// Export type definition for consumers of this module.
export type OverdueLoadStatus = "idle" | "loading" | "ready" | "error";

// Export type definition for consumers of this module.
export type OverdueState = {
  // Provide status field used by this structure.
  status: OverdueLoadStatus;
  // Provide sessions field used by this structure.
  sessions: OverdueSession[];
  /** True after at least one successful fetch (including empty). */
  hasSuccessfulLoad: boolean;
  /** True when sessions are from a previous success and the latest fetch failed. */
  stale: boolean;
  // Provide error field used by this structure.
  error: string | null;
};

// Export INITIAL_OVERDUE_STATE for use by other modules.
export const INITIAL_OVERDUE_STATE: OverdueState = {
  // Provide status field used by this structure.
  status: "idle",
  // Provide sessions field used by this structure.
  sessions: [],
  // Provide hasSuccessfulLoad field used by this structure.
  hasSuccessfulLoad: false,
  // Provide stale field used by this structure.
  stale: false,
  // Provide error field used by this structure.
  error: null,
};

/** Mark that an overdue fetch is in flight. */
export function overdueLoading(prev: OverdueState): OverdueState {
  // Return early result or rendered output from this path.
  return {
    // Spread prior fields/items so overrides can layer cleanly.
    ...prev,
    // Provide status field used by this structure.
    status: "loading",
    // Provide error field used by this structure.
    error: null,
  };
}

/** Successful overdue fetch (may be an empty list). */
export function overdueReady(sessions: OverdueSession[]): OverdueState {
  // Return early result or rendered output from this path.
  return {
    // Provide status field used by this structure.
    status: "ready",
    // Support the surrounding logic for this step.
    sessions,
    // Provide hasSuccessfulLoad field used by this structure.
    hasSuccessfulLoad: true,
    // Provide stale field used by this structure.
    stale: false,
    // Provide error field used by this structure.
    error: null,
  };
}

/**
 * Failed overdue fetch.
 * Keeps prior sessions when a successful load already happened (incl. empty).
 */
export function overdueFailed(
  // Provide prev field used by this structure.
  prev: OverdueState,
  // Provide message field used by this structure.
  message: string,
// Support the surrounding logic for this step.
): OverdueState {
  // Conditional branch for the case described by this guard.
  if (prev.hasSuccessfulLoad) {
    // Return early result or rendered output from this path.
    return {
      // Provide status field used by this structure.
      status: "error",
      // Provide sessions field used by this structure.
      sessions: prev.sessions,
      // Provide hasSuccessfulLoad field used by this structure.
      hasSuccessfulLoad: true,
      // Provide stale field used by this structure.
      stale: true,
      // Provide error field used by this structure.
      error: message,
    };
  }
  // Return early result or rendered output from this path.
  return {
    // Provide status field used by this structure.
    status: "error",
    // Provide sessions field used by this structure.
    sessions: [],
    // Provide hasSuccessfulLoad field used by this structure.
    hasSuccessfulLoad: false,
    // Provide stale field used by this structure.
    stale: false,
    // Provide error field used by this structure.
    error: message,
  };
}

/** Whether the overdue filter can be treated as authoritative. */
export function overdueFilterReliable(state: OverdueState): boolean {
  // Return early result or rendered output from this path.
  return state.status === "ready" && !state.stale;
}

/** Show the empty "no overdue" copy only after a successful empty load. */
export function showOverdueEmpty(state: OverdueState): boolean {
  // Return early result or rendered output from this path.
  return state.status === "ready" && !state.stale && state.sessions.length === 0;
}

/**
 * Apply a fetch outcome only when `revision` is still current.
 * Used by LocationsPage loadOverdue to ignore stale responses.
 */
export function applyOverdueFetchResult(
  // Provide currentRevision field used by this structure.
  currentRevision: number,
  // Provide resultRevision field used by this structure.
  resultRevision: number,
  // Provide outcome field used by this structure.
  outcome:
    // Support the surrounding logic for this step.
    | { ok: true; sessions: OverdueSession[] }
    // Support the surrounding logic for this step.
    | { ok: false; message: string },
  // Provide prev field used by this structure.
  prev: OverdueState,
// Support the surrounding logic for this step.
): OverdueState | null {
  // Conditional branch for the case described by this guard.
  if (resultRevision !== currentRevision) return null;
  // Conditional branch for the case described by this guard.
  if (outcome.ok) return overdueReady(outcome.sessions);
  // Return early result or rendered output from this path.
  return overdueFailed(prev, outcome.message);
}
