/**
 * Busy-guarded mutate-then-refresh helper.
 * Successful saves stay successful even when the follow-up refresh fails.
 */
import { useCallback, useRef, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  classifySaveRefreshOutcome,
  // List item in import/export/params.
  executeMutationWithRefresh,
  // Local type alias shaping data.
  type MutationWithRefreshFailure,
  // Local type alias shaping data.
  type MutationWithRefreshResult,
  // Local type alias shaping data.
  type MutationWithRefreshSuccess,
// Close multi-line construct with trailing syntax.
} from "../saveRefresh";

// Export type alias for consumers.
export type BusyMutationSuccess<T> = MutationWithRefreshSuccess<T>;
// Export type alias for consumers.
export type BusyMutationFailure = MutationWithRefreshFailure;
// Export type alias for consumers.
export type BusyMutationResult<T> = MutationWithRefreshResult<T>;

// Exported function entry point.
export function useBusyMutation() {
  // Assign value for subsequent use.
  const [busy, setBusy] = useState(false);
  // Local constant binding.
  const busyRef = useRef(false);

  // Local constant binding.
  const runMutationWithRefresh = useCallback(
    // Open multi-line construct.
    async <T,>(
      // Arrow function / callback body.
      mutate: () => Promise<T>,
      // Arrow function / callback body.
      refresh?: () => Promise<void>,
    // Arrow function / callback body.
    ): Promise<BusyMutationResult<T>> => {
      // Conditional branch for this case.
      if (busyRef.current) {
        // Return computed result to caller.
        return { ok: false, error: "busy", outcome: "save_failed" };
      }
      // Assign value for subsequent use.
      busyRef.current = true;
      // Invoke helper or pass arguments.
      setBusy(true);
      // Guard fallible work.
      try {
        // Return computed result to caller.
        return await executeMutationWithRefresh(mutate, refresh);
      // Open multi-line construct.
      } finally {
        // Assign value for subsequent use.
        busyRef.current = false;
        // Invoke helper or pass arguments.
        setBusy(false);
      }
    },
    // Continue multi-line list/arguments.
    [],
  );

  // Return computed result to caller.
  return { busy, busyRef, runMutationWithRefresh, classifySaveRefreshOutcome };
}
