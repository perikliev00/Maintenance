/**
 * React hook: debounced refetch when shared SSE domain events fire.
 * Skips while `busy` so a local mutation's own refresh is not doubled.
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
  // Refs keep the subscription stable while props change every render.
  const refreshRef = useRef(refresh);
  const busyRef = useRef(busy);
  const typesRef = useRef(new Set(eventTypes));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync latest callbacks/flags into refs (effect does not re-subscribe on these).
  refreshRef.current = refresh;
  busyRef.current = busy;
  typesRef.current = new Set(eventTypes);

  useEffect(() => {
    // Disabled pages skip the shared SSE subscription entirely.
    if (!enabled) return;

    const unsubscribe = subscribeLiveEvents((event: LiveEvent) => {
      // Handshake-only; not a domain change.
      if (event.type === "connected") return;
      // Caller may narrow to a subset of domain events.
      if (!typesRef.current.has(event.type)) return;
      // Local mutation already refreshing — avoid a duplicate fetch.
      if (busyRef.current) return;

      // Debounce bursty SSE (many entities changing at once).
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void (async () => {
          // Re-check busy after the debounce window.
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
      // Clear pending debounce and leave the shared SSE fan-out.
      if (timerRef.current) clearTimeout(timerRef.current);
      unsubscribe();
    };
  }, [enabled, debounceMs]);

  return lastAt;
}
