/**
 * React hook: debounced refetch when shared SSE domain events fire.
 * Defers events while `busy` and catches up whenever the stream reconnects.
 */
import { useEffect, useRef, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  subscribeLiveEvents,
  // Local type alias shaping data.
  type LiveEvent,
  // Local type alias shaping data.
  type LiveEventType,
// Close multi-line construct with trailing syntax.
} from "../api/client";

/** Default event types that mean "domain data may have changed". */
const DOMAIN_EVENTS: LiveEventType[] = [
  // Continue multi-line list/arguments.
  "location.changed",
  // Continue multi-line list/arguments.
  "cleaning.changed",
  // Continue multi-line list/arguments.
  "ticket.changed",
  // Continue multi-line list/arguments.
  "settings.changed",
  // Continue multi-line list/arguments.
  "people.changed",
];

// Local type alias shaping data.
type Options = {
  // Field/property in this shape.
  enabled?: boolean;
  /** Defer refetch while a local mutation refresh is in flight. */
  busy?: boolean;
  /** If set, only these event types trigger refresh. */
  eventTypes?: LiveEventType[];
  // Field/property in this shape.
  debounceMs?: number;
};

/**
 * Debounced live refresh via SSE. Returns last event timestamp (ISO) when an
 * update was applied.
 */
export function useLiveRefresh(
  // Arrow function / callback body.
  refresh: () => Promise<void> | void,
  // Field/property in this shape.
  options: Options = {},
// Open multi-line construct.
): string | null {
  // Open multi-line construct.
  const {
    // Assign value for subsequent use.
    enabled = true,
    // Assign value for subsequent use.
    busy = false,
    // Assign value for subsequent use.
    eventTypes = DOMAIN_EVENTS,
    // Assign value for subsequent use.
    debounceMs = 400,
  // Assign value for subsequent use.
  } = options;

  // Assign value for subsequent use.
  const [lastAt, setLastAt] = useState<string | null>(null);
  // Refs keep the subscription stable while props change every render.
  const refreshRef = useRef(refresh);
  // Local constant binding.
  const busyRef = useRef(busy);
  // Local constant binding.
  const typesRef = useRef(new Set(eventTypes));
  // Local constant binding.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Local constant binding.
  const flushRef = useRef<(() => void) | null>(null);

  // Sync latest callbacks/flags into refs (effect does not re-subscribe on these).
  refreshRef.current = refresh;
  // Assign value for subsequent use.
  busyRef.current = busy;
  // Assign value for subsequent use.
  typesRef.current = new Set(eventTypes);

  // Arrow function / callback body.
  useEffect(() => {
    // Disabled pages skip the shared SSE subscription entirely.
    if (!enabled) return;

    // Mutable local binding.
    let disposed = false;
    // Mutable local binding.
    let pending: LiveEvent | null = null;
    // Mutable local binding.
    let refreshing = false;
    // Const arrow/function binding.
    const schedule = () => {
      // Conditional branch for this case.
      if (disposed || !pending || busyRef.current || refreshing) return;
      // Conditional branch for this case.
      if (timerRef.current) clearTimeout(timerRef.current);
      // Arrow function / callback body.
      timerRef.current = setTimeout(() => {
        // Assign value for subsequent use.
        timerRef.current = null;
        // Conditional branch for this case.
        if (disposed || busyRef.current || refreshing || !pending) return;
        // Local constant binding.
        const applied = pending;
        // Assign value for subsequent use.
        refreshing = true;
        // Fire-and-forget async/side effect.
        void (async () => {
          // Guard fallible work.
          try {
            // Await async work before continuing.
            await refreshRef.current();
            // Conditional branch for this case.
            if (!disposed) {
              // Conditional branch for this case.
              if (pending === applied) pending = null;
              // Invoke helper or pass arguments.
              setLastAt(applied.at ?? new Date().toISOString());
            }
          // Open multi-line construct.
          } catch {
            // Keep dirty state for the next event, reconnect, or busy transition.
          } finally {
            // Assign value for subsequent use.
            refreshing = false;
            // Conditional branch for this case.
            if (pending && pending !== applied) schedule();
          }
        // Invoke helper or pass arguments.
        })();
      // Close multi-line construct with trailing syntax.
      }, debounceMs);
    };
    // Assign value for subsequent use.
    flushRef.current = schedule;

    // Local constant binding.
    const unsubscribe = subscribeLiveEvents((event: LiveEvent) => {
      // Caller may narrow to a subset of domain events.
      if (event.type !== "connected" && !typesRef.current.has(event.type)) return;
      // Assign value for subsequent use.
      pending = event;
      // Invoke helper or pass arguments.
      schedule();
    });

    // Return computed result to caller.
    return () => {
      // Assign value for subsequent use.
      disposed = true;
      // Assign value for subsequent use.
      flushRef.current = null;
      // Clear pending debounce and leave the shared SSE fan-out.
      if (timerRef.current) clearTimeout(timerRef.current);
      // Invoke helper or pass arguments.
      unsubscribe();
    };
  // Close multi-line construct with trailing syntax.
  }, [enabled, debounceMs]);

  // Arrow function / callback body.
  useEffect(() => { if (!busy) flushRef.current?.(); }, [busy]);

  // Return computed result to caller.
  return lastAt;
}
