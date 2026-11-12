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
  // React state slot for local UI/data that can change over time.
  const [error, setError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [message, setMessage] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  /** Drop the saved message and refresh warning (not `error`). */
  const clearOutcome = useCallback(() => {
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Update React state so the UI reflects the new value.
    setRefreshWarning(null);
  // Support the surrounding logic for this step.
  }, []);

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    error,
    // Support the surrounding logic for this step.
    setError,
    // Support the surrounding logic for this step.
    message,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    refreshWarning,
    // Support the surrounding logic for this step.
    setRefreshWarning,
    // Support the surrounding logic for this step.
    clearOutcome,
  };
}

// Export type definition for consumers of this module.
export type SettingsFeedback = ReturnType<typeof useSettingsFeedback>;
