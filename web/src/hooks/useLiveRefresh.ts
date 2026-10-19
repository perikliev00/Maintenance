/**
 * React hook: debounced refetch when shared SSE domain events fire.
 * Defers events while `busy` and catches up whenever the stream reconnects.
 */
import { useEffect, useRef, useState } from "react";
import {
  subscribeLiveEvents,
  type LiveEvent,
  type LiveEventType,
} from "../api/client";

/** Default event types that mean "domain data may have changed". */
const DOMAIN_EVENTS: LiveEventType[] = [
  "location.changed",
  "cleaning.changed",
  "ticket.changed",
  "settings.changed",
  "people.changed",
];

type Options = {
  enabled?: boolean;
  /** Defer refetch while a local mutation refresh is in flight. */
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
  // Refs keep the subscription stable while props change every render.
  const refreshRef = useRef(refresh);
  const busyRef = useRef(busy);
  const typesRef = useRef(new Set(eventTypes));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(() => void) | null>(null);

  // Sync latest callbacks/flags into refs (effect does not re-subscribe on these).
  refreshRef.current = refresh;
  busyRef.current = busy;
  typesRef.current = new Set(eventTypes);

  useEffect(() => {
    // Disabled pages skip the shared SSE subscription entirely.
    if (!enabled) return;

    let disposed = false;
    let pending: LiveEvent | null = null;
    let refreshing = false;
    const schedule = () => {
      if (disposed || !pending || busyRef.current || refreshing) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (disposed || busyRef.current || refreshing || !pending) return;
        const applied = pending;
        refreshing = true;
        void (async () => {
          try {
            await refreshRef.current();
            if (!disposed) {
              if (pending === applied) pending = null;
              setLastAt(applied.at ?? new Date().toISOString());
            }
          } catch {
            // Keep dirty state for the next event, reconnect, or busy transition.
          } finally {
            refreshing = false;
            if (pending && pending !== applied) schedule();
          }
        })();
      }, debounceMs);
    };
    flushRef.current = schedule;

    const unsubscribe = subscribeLiveEvents((event: LiveEvent) => {
      // Caller may narrow to a subset of domain events.
      if (event.type !== "connected" && !typesRef.current.has(event.type)) return;
      pending = event;
      schedule();
    });

    return () => {
      disposed = true;
      flushRef.current = null;
      // Clear pending debounce and leave the shared SSE fan-out.
      if (timerRef.current) clearTimeout(timerRef.current);
      unsubscribe();
    };
  }, [enabled, debounceMs]);

  useEffect(() => { if (!busy) flushRef.current?.(); }, [busy]);

  return lastAt;
}
