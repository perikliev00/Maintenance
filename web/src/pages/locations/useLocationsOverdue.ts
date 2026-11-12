/**
 * Overdue-session fetch for the Locations board.
 * Owns revision/abort gating so stale or aborted results never clobber state.
 */
import { useCallback, useRef, useState } from "react";
// Import module dependency from ../../api/client.
import { fetchOverdueSessions } from "../../api/client";
// Import module dependency from ./labels.
import { boardT, type BoardLocale } from "./labels";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  INITIAL_OVERDUE_STATE,
  // Support the surrounding logic for this step.
  applyOverdueFetchResult,
  // Support the surrounding logic for this step.
  overdueLoading,
  // Declare type alias OverdueState.
  type OverdueState,
// Support the surrounding logic for this step.
} from "./overdueState";

// Export type definition for consumers of this module.
export type UseLocationsOverdueOptions = {
  // Provide canReviewOverdue field used by this structure.
  canReviewOverdue: boolean;
  // Provide locale field used by this structure.
  locale: BoardLocale;
};

// Export type definition for consumers of this module.
export type UseLocationsOverdueResult = {
  // Provide overdueState field used by this structure.
  overdueState: OverdueState;
  // Provide loadOverdue field used by this structure.
  loadOverdue: (
    // Provide locationIds field used by this structure.
    locationIds: Set<string>,
    // Support the surrounding logic for this step.
    externalSignal?: AbortSignal,
  // Support the surrounding logic for this step.
  ) => Promise<void>;
  /** Abort in-flight fetch and invalidate its revision (mount cleanup / remount). */
  cancelOverdue: () => void;
};

// Export function useLocationsOverdue as part of this module's API.
export function useLocationsOverdue({
  // Support the surrounding logic for this step.
  canReviewOverdue,
  // Support the surrounding logic for this step.
  locale,
// Support the surrounding logic for this step.
}: UseLocationsOverdueOptions): UseLocationsOverdueResult {
  // React state slot for local UI/data that can change over time.
  const [overdueState, setOverdueState] = useState<OverdueState>(
    // Support the surrounding logic for this step.
    INITIAL_OVERDUE_STATE,
  );
  // Hold a mutable ref that persists across renders without re-render.
  const overdueRevision = useRef(0);
  // Bind overdueAbortRef for use in the following logic.
  const overdueAbortRef = useRef<AbortController | null>(null);

  // Memoize callback identity for stable child/effect deps.
  const cancelOverdue = useCallback(() => {
    // Support the surrounding logic for this step.
    overdueAbortRef.current?.abort();
    // Support the surrounding logic for this step.
    overdueRevision.current += 1;
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const loadOverdue = useCallback(
    // Support the surrounding logic for this step.
    async (locationIds: Set<string>, externalSignal?: AbortSignal) => {
      // Conditional branch for the case described by this guard.
      if (!canReviewOverdue) return;
      // Support the surrounding logic for this step.
      overdueAbortRef.current?.abort();
      // Bind ac for use in the following logic.
      const ac = new AbortController();
      // Support the surrounding logic for this step.
      overdueAbortRef.current = ac;
      // Bind onExternalAbort for use in the following logic.
      const onExternalAbort = () => ac.abort();
      // Support the surrounding logic for this step.
      externalSignal?.addEventListener("abort", onExternalAbort);
      // Bind revision for use in the following logic.
      const revision = ++overdueRevision.current;
      // Update React state so the UI reflects the new value.
      setOverdueState((prev) => overdueLoading(prev));
      // Begin guarded block to catch runtime failures.
      try {
        // Bind sessions for use in the following logic.
        const sessions = await fetchOverdueSessions({ signal: ac.signal });
        // Conditional branch for the case described by this guard.
        if (ac.signal.aborted) return;
        // Filter items down to those relevant for this view.
        const filtered = sessions.filter((s) => locationIds.has(s.room.id));
        // Update React state so the UI reflects the new value.
        setOverdueState((prev) => {
          // Bind next for use in the following logic.
          const next = applyOverdueFetchResult(
            // Support the surrounding logic for this step.
            overdueRevision.current,
            // Support the surrounding logic for this step.
            revision,
            // Support the surrounding logic for this step.
            { ok: true, sessions: filtered },
            // Support the surrounding logic for this step.
            prev,
          );
          // Return early result or rendered output from this path.
          return next ?? prev;
        });
      // Support the surrounding logic for this step.
      } catch (err) {
        // Conditional branch for the case described by this guard.
        if (ac.signal.aborted) return;
        // Conditional branch for the case described by this guard.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Bind message for use in the following logic.
        const message =
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : boardT(
                // Support the surrounding logic for this step.
                locale,
                // Support the surrounding logic for this step.
                "Неуспешна проверка за просрочени сесии",
                // Support the surrounding logic for this step.
                "Failed to check overdue sessions",
              );
        // Update React state so the UI reflects the new value.
        setOverdueState((prev) => {
          // Bind next for use in the following logic.
          const next = applyOverdueFetchResult(
            // Support the surrounding logic for this step.
            overdueRevision.current,
            // Support the surrounding logic for this step.
            revision,
            // Support the surrounding logic for this step.
            { ok: false, message },
            // Support the surrounding logic for this step.
            prev,
          );
          // Return early result or rendered output from this path.
          return next ?? prev;
        });
      // Support the surrounding logic for this step.
      } finally {
        // Support the surrounding logic for this step.
        externalSignal?.removeEventListener("abort", onExternalAbort);
      }
    },
    // Support the surrounding logic for this step.
    [canReviewOverdue, locale],
  );

  // Return early result or rendered output from this path.
  return { overdueState, loadOverdue, cancelOverdue };
}
