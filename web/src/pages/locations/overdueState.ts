/**
 * Overdue-session load state for the Locations board.
 * Distinguishes empty success from failed fetches so the UI never claims
 * "no overdue" when the check did not complete.
 *
 * `hasSuccessfulLoad` survives loading transitions so a failed refresh can
 * keep the last successful payload (including an empty list) as stale.
 */
import type { OverdueSession } from "../../api/client";

export type OverdueLoadStatus = "idle" | "loading" | "ready" | "error";

export type OverdueState = {
  status: OverdueLoadStatus;
  sessions: OverdueSession[];
  /** True after at least one successful fetch (including empty). */
  hasSuccessfulLoad: boolean;
  /** True when sessions are from a previous success and the latest fetch failed. */
  stale: boolean;
  error: string | null;
};

export const INITIAL_OVERDUE_STATE: OverdueState = {
  status: "idle",
  sessions: [],
  hasSuccessfulLoad: false,
  stale: false,
  error: null,
};

/** Mark that an overdue fetch is in flight. */
export function overdueLoading(prev: OverdueState): OverdueState {
  return {
    ...prev,
    status: "loading",
    error: null,
  };
}

/** Successful overdue fetch (may be an empty list). */
export function overdueReady(sessions: OverdueSession[]): OverdueState {
  return {
    status: "ready",
    sessions,
    hasSuccessfulLoad: true,
    stale: false,
    error: null,
  };
}

/**
 * Failed overdue fetch.
 * Keeps prior sessions when a successful load already happened (incl. empty).
 */
export function overdueFailed(
  prev: OverdueState,
  message: string,
): OverdueState {
  if (prev.hasSuccessfulLoad) {
    return {
      status: "error",
      sessions: prev.sessions,
      hasSuccessfulLoad: true,
      stale: true,
      error: message,
    };
  }
  return {
    status: "error",
    sessions: [],
    hasSuccessfulLoad: false,
    stale: false,
    error: message,
  };
}

/** Whether the overdue filter can be treated as authoritative. */
export function overdueFilterReliable(state: OverdueState): boolean {
  return state.status === "ready" && !state.stale;
}

/** Show the empty "no overdue" copy only after a successful empty load. */
export function showOverdueEmpty(state: OverdueState): boolean {
  return state.status === "ready" && !state.stale && state.sessions.length === 0;
}

/**
 * Apply a fetch outcome only when `revision` is still current.
 * Used by LocationsPage loadOverdue to ignore stale responses.
 */
export function applyOverdueFetchResult(
  currentRevision: number,
  resultRevision: number,
  outcome:
    | { ok: true; sessions: OverdueSession[] }
    | { ok: false; message: string },
  prev: OverdueState,
): OverdueState | null {
  if (resultRevision !== currentRevision) return null;
  if (outcome.ok) return overdueReady(outcome.sessions);
  return overdueFailed(prev, outcome.message);
}
