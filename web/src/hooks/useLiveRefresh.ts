import { useEffect, useRef, useState } from "react";
import {
  subscribeLiveEvents,
  type LiveEvent,
  type LiveEventType,
} from "../api/client";

const DOMAIN_EVENTS: LiveEventType[] = [
  "location.changed",
  "cleaning.changed",
  "ticket.changed",
  "settings.changed",
  "people.changed",
];

type Options = {
  enabled?: boolean;
  /** Skip refetch while a local mutation refresh is in flight. */
  busy?: boolean;
  /** If set, only these event types trigger refresh. */
  eventTypes?: LiveEventType[];
  debounceMs?: number;
};

/**
 * Debounced live refresh via SSE. Returns last event timestamp (ISO) when an
 * update was applied.
 */
export function useLiveRefresh(
  refresh: () => Promise<void> | void,
  options: Options = {},
): string | null {
  const {
    enabled = true,
    busy = false,
    eventTypes = DOMAIN_EVENTS,
    debounceMs = 400,
  } = options;

  const [lastAt, setLastAt] = useState<string | null>(null);
  const refreshRef = useRef(refresh);
  const busyRef = useRef(busy);
  const typesRef = useRef(new Set(eventTypes));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  refreshRef.current = refresh;
  busyRef.current = busy;
  typesRef.current = new Set(eventTypes);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeLiveEvents((event: LiveEvent) => {
      if (event.type === "connected") return;
      if (!typesRef.current.has(event.type)) return;
      if (busyRef.current) return;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void (async () => {
          if (busyRef.current) return;
          try {
            await refreshRef.current();
            setLastAt(event.at ?? new Date().toISOString());
          } catch {
            // keep previous data; next event or manual refresh will retry
          }
        })();
      }, debounceMs);
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsubscribe();
    };
  }, [enabled, debounceMs]);

  return lastAt;
}
