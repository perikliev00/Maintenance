/**
 * In-process pub/sub for live SSE events.
 * Publishers call publish(); the /events/stream handler subscribes and filters
 * delivery with authorizeLiveEvent / data scope.
 */
// Node EventEmitter used as the in-process live channel.
import { EventEmitter } from "events";

// Discriminated live event types the SSE stream may deliver.
export type LiveEventType =
  | "location.changed"
  | "cleaning.changed"
  | "ticket.changed"
  | "settings.changed"
  | "people.changed"
  | "permissions.changed"
  | "notification.changed"
  | "jobs.changed";

// Payload shape stamped with `at` before fan-out.
export type LiveEvent = {
  type: LiveEventType;
  locationId?: string;
  taskId?: string;
  ticketId?: string;
  recipientEmployeeId?: string;
  at: string;
};

// Subscriber callback invoked for every published live event.
type Listener = (event: LiveEvent) => void;

// Process-local emitter; not shared across Node processes/replicas.
const emitter = new EventEmitter();
// Many concurrent SSE clients each register a listener.
emitter.setMaxListeners(100);

/** Stamp `at` and fan out to all live subscribers; returns the emitted event. */
export function publish(
  type: LiveEventType,
  payload: {
    locationId?: string;
    taskId?: string;
    ticketId?: string;
    recipientEmployeeId?: string;
  } = {},
): LiveEvent {
  // ISO timestamp so clients can order/dedupe without trusting wall clock alone.
  const event: LiveEvent = {
    type,
    ...payload,
    at: new Date().toISOString(),
  };
  // Single channel name; subscribers filter by type/scope themselves.
  emitter.emit("live", event);
  return event;
}

/** Register a live listener; returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  emitter.on("live", listener);
  // Caller must unsubscribe on SSE disconnect to avoid leaking listeners.
  return () => {
    emitter.off("live", listener);
  };
}
