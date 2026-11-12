/**
 * Settings change-history lifecycle (read-only timeline tab).
 *
 * Failures are held in `historyError` and shown on the History tab only; they
 * never use the shared settings error banner or block editing/saving.
 */
import { useCallback, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchSettingsHistory,
  // Declare type alias SettingHistoryRow.
  type SettingHistoryRow,
// Support the surrounding logic for this step.
} from "../../api/client";

// Bind HISTORY_LIMIT for use in the following logic.
const HISTORY_LIMIT = 80;

// Export function useSettingsHistory as part of this module's API.
export function useSettingsHistory() {
  // React state slot for local UI/data that can change over time.
  const [history, setHistory] = useState<SettingHistoryRow[]>([]);
  // React state slot for local UI/data that can change over time.
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Latest-request-wins across tab loads and post-save refreshes.
  const revisionRef = useRef(0);

  /**
   * Reload the timeline. Records `historyError` and also rejects, so callers
   * that aggregate follow-up reads (save) can report it as a refresh warning.
   */
  const refresh = useCallback(async () => {
    // Bind mine for use in the following logic.
    const mine = ++revisionRef.current;
    // Begin guarded block to catch runtime failures.
    try {
      // Bind rows for use in the following logic.
      const rows = await fetchSettingsHistory({ limit: HISTORY_LIMIT });
      // Conditional branch for the case described by this guard.
      if (mine !== revisionRef.current) return;
      // Update React state so the UI reflects the new value.
      setHistory(rows);
      // Update React state so the UI reflects the new value.
      setHistoryError(null);
    // Support the surrounding logic for this step.
    } catch (err) {
      // Conditional branch for the case described by this guard.
      if (mine === revisionRef.current) {
        // Update React state so the UI reflects the new value.
        setHistoryError(
          // Support the surrounding logic for this step.
          err instanceof Error ? err.message : "History failed",
        );
      }
      // Abort this path by throwing an error to callers.
      throw err;
    }
  // Support the surrounding logic for this step.
  }, []);

  /** Tab-open load: failure stays in `historyError` only. */
  const load = useCallback(() => {
    // Fire-and-forget async work without awaiting in this path.
    void refresh().catch(() => undefined);
  // Support the surrounding logic for this step.
  }, [refresh]);

  // Return early result or rendered output from this path.
  return { history, historyError, refresh, load };
}
