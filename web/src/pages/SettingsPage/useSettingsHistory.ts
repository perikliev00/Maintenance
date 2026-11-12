/**
 * Settings change-history lifecycle (read-only timeline tab).
 *
 * Failures are held in `historyError` and shown on the History tab only; they
 * never use the shared settings error banner or block editing/saving.
 */
import { useCallback, useRef, useState } from "react";
import {
  fetchSettingsHistory,
  type SettingHistoryRow,
} from "../../api/client";

const HISTORY_LIMIT = 80;

// Export function useSettingsHistory as part of this module's API.
export function useSettingsHistory() {
  const [history, setHistory] = useState<SettingHistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Latest-request-wins across tab loads and post-save refreshes.
  const revisionRef = useRef(0);

  /**
   * Reload the timeline. Records `historyError` and also rejects, so callers
   * that aggregate follow-up reads (save) can report it as a refresh warning.
   */
  const refresh = useCallback(async () => {
    const mine = ++revisionRef.current;
    try {
      const rows = await fetchSettingsHistory({ limit: HISTORY_LIMIT });
      if (mine !== revisionRef.current) return;
      setHistory(rows);
      setHistoryError(null);
    } catch (err) {
      if (mine === revisionRef.current) {
        setHistoryError(
          err instanceof Error ? err.message : "History failed",
        );
      }
      // Abort this path by throwing an error to callers.
      throw err;
    }
  }, []);

  /** Tab-open load: failure stays in `historyError` only. */
  const load = useCallback(() => {
    // Fire-and-forget async work without awaiting in this path.
    void refresh().catch(() => undefined);
  }, [refresh]);

  return { history, historyError, refresh, load };
}
