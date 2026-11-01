/**
 * Shared Server-Sent Events fan-out for live board / page refresh.
 *
 * A single credentialed fetch stream is multiplexed to all subscribers so tabs
 * do not open parallel SSE connections (which would thrash reconnect backoff).
 */
import { API_BASE, apiFetch } from "./http";

export type LiveEventType =
  | "location.changed"
  | "cleaning.changed"
  | "ticket.changed"
  | "settings.changed"
  | "people.changed"
  | "permissions.changed"
  | "notification.changed"
  | "jobs.changed"
  | "connected";

export type LiveEvent = {
  type: LiveEventType;
  locationId?: string;
  taskId?: string;
  ticketId?: string;
  recipientEmployeeId?: string;
  at?: string;
  ok?: boolean;
  userId?: string;
};

const LIVE_EVENT_TYPES = new Set<string>([
  "connected",
  "location.changed",
  "cleaning.changed",
  "ticket.changed",
  "settings.changed",
  "people.changed",
  "permissions.changed",
  "notification.changed",
  "jobs.changed",
]);

/**
 * Parse complete SSE frames from a streaming buffer.
 * @returns Unconsumed trailing bytes (incomplete frame) for the next read.
 */
function parseSseChunk(
  buffer: string,
  onEvent: (event: LiveEvent) => void,
): string {
  // SSE frames are separated by a blank line.
  const parts = buffer.split(/\r?\n\r?\n/);
  // Last segment may be incomplete — keep it for the next chunk.
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    let eventType = "message";
    const dataLines: string[] = [];
    for (const rawLine of part.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      // Skip empty lines and SSE comments (`:`).
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    // Ignore unknown event names so future server events do not break clients.
    if (!LIVE_EVENT_TYPES.has(eventType)) continue;
    let data: Record<string, unknown> = {};
    const rawData = dataLines.join("\n");
    if (rawData) {
      // Malformed JSON → empty payload rather than killing the stream.
      try {
        data = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }
    onEvent({
      type: eventType as LiveEventType,
      ...data,
    });
  }

  return remainder;
}

type LiveListener = {
  onEvent: (event: LiveEvent) => void;
  onError?: (err: Event) => void;
};

/** One shared SSE stream for the whole app — pages must not open parallel ones. */
const liveListeners = new Set<LiveListener>();
let liveController: AbortController | null = null;
let liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let liveBackoffMs = 1000;
let liveConnecting = false;
const LIVE_MAX_BACKOFF_MS = 30_000;

/** Fan out a parsed event to a snapshot of listeners (safe if one unsubscribes). */
function emitLiveEvent(event: LiveEvent) {
  for (const listener of [...liveListeners]) {
    try {
      listener.onEvent(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Fan out stream errors without throwing across listeners. */
function emitLiveError(err: Event) {
  for (const listener of [...liveListeners]) {
    try {
      listener.onError?.(err);
    } catch {
      /* ignore */
    }
  }
}

/** Abort the shared fetch and reset reconnect backoff. */
function stopSharedLiveStream() {
  if (liveReconnectTimer) {
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = null;
  }
  liveController?.abort();
  liveController = null;
  liveConnecting = false;
  liveBackoffMs = 1000;
}

/** Schedule one reconnect with exponential backoff (capped). */
function scheduleSharedLiveReconnect() {
  // No subscribers → do not reconnect.
  if (liveListeners.size === 0) return;
  // Already scheduled → avoid stacking timers.
  if (liveReconnectTimer) return;
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    void ensureSharedLiveStream();
  }, liveBackoffMs);
  liveBackoffMs = Math.min(liveBackoffMs * 2, LIVE_MAX_BACKOFF_MS);
}

/**
 * Open (or keep) the single shared SSE fetch when at least one listener exists.
 * Handles 401 (no reconnect), other failures (backoff reconnect), and clean abort.
 */
async function ensureSharedLiveStream() {
  // Idle or already connecting / open — nothing to do.
  if (liveListeners.size === 0 || liveConnecting) return;
  if (liveController && !liveController.signal.aborted) return;

  liveConnecting = true;
  const controller = new AbortController();
  liveController = controller;

  try {
    const res = await apiFetch(`${API_BASE}/events/stream`, {
      signal: controller.signal,
    });

    // Unsubscribed while fetch was in flight.
    if (controller.signal.aborted) return;

    // Auth loss — surface error; do not hammer reconnect.
    if (res.status === 401) {
      emitLiveError(new Event("error"));
      return;
    }

    // Transient HTTP / missing body — notify and reconnect with backoff.
    if (!res.ok || !res.body) {
      emitLiveError(new Event("error"));
      scheduleSharedLiveReconnect();
      return;
    }

    // Successful open resets backoff for the next failure.
    liveBackoffMs = 1000;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Read until abort, last listener gone, or stream ends.
    while (!controller.signal.aborted && liveListeners.size > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, emitLiveEvent);
    }

    // Unexpected EOF with listeners still present → reconnect.
    if (!controller.signal.aborted && liveListeners.size > 0) {
      emitLiveError(new Event("error"));
      scheduleSharedLiveReconnect();
    }
  } catch (err) {
    // Expected on unsubscribe / stopSharedLiveStream.
    if (controller.signal.aborted) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    emitLiveError(new Event("error"));
    scheduleSharedLiveReconnect();
  } finally {
    // Only clear if we still own the controller (a newer start may have replaced it).
    if (liveController === controller) {
      liveController = null;
    }
    liveConnecting = false;
  }
}

/**
 * Subscribe to server-sent live events via a shared credentialed fetch stream.
 * @returns Unsubscribe; stops the shared stream when the last listener leaves.
 */
export function subscribeLiveEvents(
  onEvent: (event: LiveEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const listener: LiveListener = { onEvent, onError };
  liveListeners.add(listener);
  // Ensure the shared stream is running for this first (or additional) listener.
  void ensureSharedLiveStream();

  return () => {
    liveListeners.delete(listener);
    // Last subscriber left — tear down connection and backoff state.
    if (liveListeners.size === 0) {
      stopSharedLiveStream();
    }
  };
}
