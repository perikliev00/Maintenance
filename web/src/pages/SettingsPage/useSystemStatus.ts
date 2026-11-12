/**
 * System diagnostics lifecycle for Settings (API/DB health + entity counts).
 *
 * Fully independent of the settings draft: refreshing never reads or writes
 * draft/reason/conflict state, and a failed fetch only marks diagnostics
 * `stale` — it never raises a settings error or fails a save.
 */
import { useCallback, useRef, useState } from "react";
import { fetchSystemStatus, type SystemStatus } from "../../api/client";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { SYSTEM_STATUS_LIVE_EVENTS } from "./settingsDraftLogic";

type Options = {
  /** Gate the live subscription (e.g. until the initial page load settles). */
  liveEnabled: boolean;
};

// Export function useSystemStatus as part of this module's API.
export function useSystemStatus({ liveEnabled }: Options) {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [stale, setStale] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  // Latest-request-wins: an older response must not overwrite a newer one.
  const revisionRef = useRef(0);

  /** Refresh diagnostics only. Never rejects: failure → `stale`. */
  const refresh = useCallback(async () => {
    const mine = ++revisionRef.current;
    try {
      const sys = await fetchSystemStatus();
      if (mine !== revisionRef.current) return;
      setSystem(sys);
      setLastSuccessAt(sys.fetchedAt ?? sys.serverTime);
      setStale(false);
    } catch {
      if (mine !== revisionRef.current) return;
      setStale(true);
    }
  }, []);

  // Event-driven counts (tickets / cleaning / locations); never deferred by
  // settings saves because it cannot touch the draft.
  useLiveRefresh(
    () => {
      // Fire-and-forget async work without awaiting in this path.
      void refresh();
    },
    {
      enabled: liveEnabled,
      busy: false,
      eventTypes: [...SYSTEM_STATUS_LIVE_EVENTS],
      debounceMs: 600,
    },
  );

  return { system, stale, lastSuccessAt, refresh };
}
