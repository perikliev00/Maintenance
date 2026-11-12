/**
 * System diagnostics lifecycle for Settings (API/DB health + entity counts).
 *
 * Fully independent of the settings draft: refreshing never reads or writes
 * draft/reason/conflict state, and a failed fetch only marks diagnostics
 * `stale` — it never raises a settings error or fails a save.
 */
import { useCallback, useRef, useState } from "react";
// Import module dependency from ../../api/client.
import { fetchSystemStatus, type SystemStatus } from "../../api/client";
// Import module dependency from ../../hooks/useLiveRefresh.
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
// Import module dependency from ./settingsDraftLogic.
import { SYSTEM_STATUS_LIVE_EVENTS } from "./settingsDraftLogic";

// Declare type alias Options.
type Options = {
  /** Gate the live subscription (e.g. until the initial page load settles). */
  liveEnabled: boolean;
};

// Export function useSystemStatus as part of this module's API.
export function useSystemStatus({ liveEnabled }: Options) {
  // React state slot for local UI/data that can change over time.
  const [system, setSystem] = useState<SystemStatus | null>(null);
  // React state slot for local UI/data that can change over time.
  const [stale, setStale] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  // Latest-request-wins: an older response must not overwrite a newer one.
  const revisionRef = useRef(0);

  /** Refresh diagnostics only. Never rejects: failure → `stale`. */
  const refresh = useCallback(async () => {
    // Bind mine for use in the following logic.
    const mine = ++revisionRef.current;
    // Begin guarded block to catch runtime failures.
    try {
      // Bind sys for use in the following logic.
      const sys = await fetchSystemStatus();
      // Conditional branch for the case described by this guard.
      if (mine !== revisionRef.current) return;
      // Update React state so the UI reflects the new value.
      setSystem(sys);
      // Update React state so the UI reflects the new value.
      setLastSuccessAt(sys.fetchedAt ?? sys.serverTime);
      // Update React state so the UI reflects the new value.
      setStale(false);
    // Support the surrounding logic for this step.
    } catch {
      // Conditional branch for the case described by this guard.
      if (mine !== revisionRef.current) return;
      // Update React state so the UI reflects the new value.
      setStale(true);
    }
  // Support the surrounding logic for this step.
  }, []);

  // Event-driven counts (tickets / cleaning / locations); never deferred by
  // settings saves because it cannot touch the draft.
  useLiveRefresh(
    // Support the surrounding logic for this step.
    () => {
      // Fire-and-forget async work without awaiting in this path.
      void refresh();
    },
    {
      // Provide enabled field used by this structure.
      enabled: liveEnabled,
      // Provide busy field used by this structure.
      busy: false,
      // Provide eventTypes field used by this structure.
      eventTypes: [...SYSTEM_STATUS_LIVE_EVENTS],
      // Provide debounceMs field used by this structure.
      debounceMs: 600,
    },
  );

  // Return early result or rendered output from this path.
  return { system, stale, lastSuccessAt, refresh };
}
