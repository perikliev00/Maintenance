import { EventEmitter } from "events";

export type LiveEventType =
  | "location.changed"
  | "cleaning.changed"
  | "ticket.changed"
  | "settings.changed"
  | "people.changed"
  | "notification.changed";

export type LiveEvent = {
  type: LiveEventType;
  locationId?: string;
  taskId?: string;
  ticketId?: string;
  recipientEmployeeId?: string;
  at: string;
};

type Listener = (event: LiveEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function publish(
  type: LiveEventType,
  payload: {
    locationId?: string;
    taskId?: string;
    ticketId?: string;
    recipientEmployeeId?: string;
  } = {},
): LiveEvent {
  const event: LiveEvent = {
    type,
    ...payload,
    at: new Date().toISOString(),
  };
  emitter.emit("live", event);
  return event;
}

export function subscribe(listener: Listener): () => void {
  emitter.on("live", listener);
  return () => {
    emitter.off("live", listener);
  };
}
