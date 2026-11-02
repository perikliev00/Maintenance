/**
 * Busy-guarded mutate-then-refresh helper.
 * Successful saves stay successful even when the follow-up refresh fails.
 */
import { useCallback, useRef, useState } from "react";
import {
  classifySaveRefreshOutcome,
  executeMutationWithRefresh,
  type MutationWithRefreshFailure,
  type MutationWithRefreshResult,
  type MutationWithRefreshSuccess,
} from "../saveRefresh";

export type BusyMutationSuccess<T> = MutationWithRefreshSuccess<T>;
export type BusyMutationFailure = MutationWithRefreshFailure;
export type BusyMutationResult<T> = MutationWithRefreshResult<T>;

export function useBusyMutation() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const runMutationWithRefresh = useCallback(
    async <T,>(
      mutate: () => Promise<T>,
      refresh?: () => Promise<void>,
    ): Promise<BusyMutationResult<T>> => {
      if (busyRef.current) {
        return { ok: false, error: "busy", outcome: "save_failed" };
      }
      busyRef.current = true;
      setBusy(true);
      try {
        return await executeMutationWithRefresh(mutate, refresh);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  return { busy, busyRef, runMutationWithRefresh, classifySaveRefreshOutcome };
}
