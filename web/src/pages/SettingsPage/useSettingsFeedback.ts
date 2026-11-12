/**
 * Banner state for settings *edits and saves* (error / saved message /
 * post-save refresh warning).
 *
 * Deliberately excludes system-status, history and SLA-policy failures: each
 * of those owns its own error so a failed side read never reads as a failed
 * settings save (or vice versa).
 */
import { useCallback, useState } from "react";

// Export function useSettingsFeedback as part of this module's API.
export function useSettingsFeedback() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  /** Drop the saved message and refresh warning (not `error`). */
  const clearOutcome = useCallback(() => {
    setMessage(null);
    setRefreshWarning(null);
  }, []);

  return {
    error,
    setError,
    message,
    setMessage,
    refreshWarning,
    setRefreshWarning,
    clearOutcome,
  };
}

export type SettingsFeedback = ReturnType<typeof useSettingsFeedback>;
