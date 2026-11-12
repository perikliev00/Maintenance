/**
 * Overdue-session fetch for the Locations board.
 * Owns revision/abort gating so stale or aborted results never clobber state.
 */
import { useCallback, useRef, useState } from "react";
import { fetchOverdueSessions } from "../../api/client";
import { boardT, type BoardLocale } from "./labels";
import {
  INITIAL_OVERDUE_STATE,
  applyOverdueFetchResult,
  overdueLoading,
  type OverdueState,
} from "./overdueState";

export type UseLocationsOverdueOptions = {
  canReviewOverdue: boolean;
  locale: BoardLocale;
};

export type UseLocationsOverdueResult = {
  overdueState: OverdueState;
  loadOverdue: (
    locationIds: Set<string>,
    externalSignal?: AbortSignal,
  ) => Promise<void>;
  /** Abort in-flight fetch and invalidate its revision (mount cleanup / remount). */
  cancelOverdue: () => void;
};

// Export function useLocationsOverdue as part of this module's API.
export function useLocationsOverdue({
  canReviewOverdue,
  locale,
}: UseLocationsOverdueOptions): UseLocationsOverdueResult {
  const [overdueState, setOverdueState] = useState<OverdueState>(
    INITIAL_OVERDUE_STATE,
  );
  const overdueRevision = useRef(0);
  const overdueAbortRef = useRef<AbortController | null>(null);

  const cancelOverdue = useCallback(() => {
    overdueAbortRef.current?.abort();
    overdueRevision.current += 1;
  }, []);

  const loadOverdue = useCallback(
    async (locationIds: Set<string>, externalSignal?: AbortSignal) => {
      if (!canReviewOverdue) return;
      overdueAbortRef.current?.abort();
      const ac = new AbortController();
      overdueAbortRef.current = ac;
      const onExternalAbort = () => ac.abort();
      externalSignal?.addEventListener("abort", onExternalAbort);
      const revision = ++overdueRevision.current;
      setOverdueState((prev) => overdueLoading(prev));
      try {
        const sessions = await fetchOverdueSessions({ signal: ac.signal });
        if (ac.signal.aborted) return;
        // Filter items down to those relevant for this view.
        const filtered = sessions.filter((s) => locationIds.has(s.room.id));
        setOverdueState((prev) => {
          const next = applyOverdueFetchResult(
            overdueRevision.current,
            revision,
            { ok: true, sessions: filtered },
            prev,
          );
          return next ?? prev;
        });
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error
            ? err.message
            : boardT(
                locale,
                "Неуспешна проверка за просрочени сесии",
                "Failed to check overdue sessions",
              );
        setOverdueState((prev) => {
          const next = applyOverdueFetchResult(
            overdueRevision.current,
            revision,
            { ok: false, message },
            prev,
          );
          return next ?? prev;
        });
      } finally {
        externalSignal?.removeEventListener("abort", onExternalAbort);
      }
    },
    [canReviewOverdue, locale],
  );

  return { overdueState, loadOverdue, cancelOverdue };
}
