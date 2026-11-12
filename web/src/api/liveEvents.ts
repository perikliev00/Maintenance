/**
 * Shared Server-Sent Events fan-out for live board / page refresh.
 *
 * A single credentialed fetch stream is multiplexed to all subscribers so tabs
 * do not open parallel SSE connections (which would thrash reconnect backoff).
 */
import { API_BASE, apiFetch } from "./http";

// Export type alias for consumers.
export type LiveEventType =
  // Union/intersection type member.
  | "location.changed"
  // Union/intersection type member.
  | "cleaning.changed"
  // Union/intersection type member.
  | "ticket.changed"
  // Union/intersection type member.
  | "settings.changed"
  // Union/intersection type member.
  | "people.changed"
  // Union/intersection type member.
  | "permissions.changed"
  // Union/intersection type member.
  | "notification.changed"
  // Union/intersection type member.
  | "jobs.changed"
  // Union/intersection type member.
  | "connected";

// Export type alias for consumers.
export type LiveEvent = {
  // Field/property in this shape.
  type: LiveEventType;
  // Field/property in this shape.
  locationId?: string;
  // Field/property in this shape.
  taskId?: string;
  // Field/property in this shape.
  ticketId?: string;
  // Field/property in this shape.
  recipientEmployeeId?: string;
  // Field/property in this shape.
  at?: string;
  // Field/property in this shape.
  ok?: boolean;
  // Field/property in this shape.
  userId?: string;
};

// Local constant binding.
const LIVE_EVENT_TYPES = new Set<string>([
  // Continue multi-line list/arguments.
  "connected",
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
  // Continue multi-line list/arguments.
  "permissions.changed",
  // Continue multi-line list/arguments.
  "notification.changed",
  // Continue multi-line list/arguments.
  "jobs.changed",
]);

/**
 * Parse complete SSE frames from a streaming buffer.
 * @returns Unconsumed trailing bytes (incomplete frame) for the next read.
 */
function parseSseChunk(
  // Field/property in this shape.
  buffer: string,
  // Arrow function / callback body.
  onEvent: (event: LiveEvent) => void,
// Open multi-line construct.
): string {
  // SSE frames are separated by a blank line.
  const parts = buffer.split(/\r?\n\r?\n/);
  // Last segment may be incomplete — keep it for the next chunk.
  const remainder = parts.pop() ?? "";

  // Iterate collection / range.
  for (const part of parts) {
    // Mutable local binding.
    let eventType = "message";
    // Local constant binding.
    const dataLines: string[] = [];
    // Iterate collection / range.
    for (const rawLine of part.split("\n")) {
      // Local constant binding.
      const line = rawLine.replace(/\r$/, "");
      // Skip empty lines and SSE comments (`:`).
      if (!line || line.startsWith(":")) continue;
      // Conditional branch for this case.
      if (line.startsWith("event:")) {
        // Assign value for subsequent use.
        eventType = line.slice(6).trim();
      // Invoke helper or pass arguments.
      } else if (line.startsWith("data:")) {
        // Invoke helper or pass arguments.
        dataLines.push(line.slice(5).trimStart());
      }
    }
    // Ignore unknown event names so future server events do not break clients.
    if (!LIVE_EVENT_TYPES.has(eventType)) continue;
    // Mutable local binding.
    let data: Record<string, unknown> = {};
    // Local constant binding.
    const rawData = dataLines.join("\n");
    // Conditional branch for this case.
    if (rawData) {
      // Malformed JSON → empty payload rather than killing the stream.
      try {
        // Assign value for subsequent use.
        data = JSON.parse(rawData) as Record<string, unknown>;
      // Open multi-line construct.
      } catch {
        // Assign value for subsequent use.
        data = {};
      }
    }
    // Open multi-line construct.
    onEvent({
      // Field/property in this shape.
      type: eventType as LiveEventType,
      // Spread remaining fields/props.
      ...data,
    });
  }

  // Return computed result to caller.
  return remainder;
}

// Local type alias shaping data.
type LiveListener = {
  // Arrow function / callback body.
  onEvent: (event: LiveEvent) => void;
  // Arrow function / callback body.
  onError?: (err: Event) => void;
};

/** One shared SSE stream for the whole app — pages must not open parallel ones. */
const liveListeners = new Set<LiveListener>();
// Mutable local binding.
let liveController: AbortController | null = null;
// Mutable local binding.
let liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
// Mutable local binding.
let liveBackoffMs = 1000;
// Mutable local binding.
let liveConnecting = false;
// Local constant binding.
const LIVE_MAX_BACKOFF_MS = 30_000;

/** Fan out a parsed event to a snapshot of listeners (safe if one unsubscribes). */
function emitLiveEvent(event: LiveEvent) {
  // Iterate collection / range.
  for (const listener of [...liveListeners]) {
    // Guard fallible work.
    try {
      // Invoke helper or pass arguments.
      listener.onEvent(event);
    // Open multi-line construct.
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Fan out stream errors without throwing across listeners. */
function emitLiveError(err: Event) {
  // Iterate collection / range.
  for (const listener of [...liveListeners]) {
    // Guard fallible work.
    try {
      // Invoke helper or pass arguments.
      listener.onError?.(err);
    // Open multi-line construct.
    } catch {
      /* ignore */
    }
  }
}

/** Abort the shared fetch and reset reconnect backoff. */
function stopSharedLiveStream() {
  // Conditional branch for this case.
  if (liveReconnectTimer) {
    // Invoke helper or pass arguments.
    clearTimeout(liveReconnectTimer);
    // Assign value for subsequent use.
    liveReconnectTimer = null;
  }
  // Invoke helper or pass arguments.
  liveController?.abort();
  // Assign value for subsequent use.
  liveController = null;
  // Assign value for subsequent use.
  liveConnecting = false;
  // Assign value for subsequent use.
  liveBackoffMs = 1000;
}

/** Schedule one reconnect with exponential backoff (capped). */
function scheduleSharedLiveReconnect() {
  // No subscribers → do not reconnect.
  if (liveListeners.size === 0) return;
  // Already scheduled → avoid stacking timers.
  if (liveReconnectTimer) return;
  // Arrow function / callback body.
  liveReconnectTimer = setTimeout(() => {
    // Assign value for subsequent use.
    liveReconnectTimer = null;
    // Fire-and-forget async/side effect.
    void ensureSharedLiveStream();
  // Close multi-line construct with trailing syntax.
  }, liveBackoffMs);
  // Assign value for subsequent use.
  liveBackoffMs = Math.min(liveBackoffMs * 2, LIVE_MAX_BACKOFF_MS);
}

/**
 * Open (or keep) the single shared SSE fetch when at least one listener exists.
 * Handles 401 (no reconnect), other failures (backoff reconnect), and clean abort.
 */
async function ensureSharedLiveStream() {
  // Idle or already connecting / open — nothing to do.
  if (liveListeners.size === 0 || liveConnecting) return;
  // Conditional branch for this case.
  if (liveController && !liveController.signal.aborted) return;

  // Assign value for subsequent use.
  liveConnecting = true;
  // Local constant binding.
  const controller = new AbortController();
  // Assign value for subsequent use.
  liveController = controller;

  // Guard fallible work.
  try {
    // Local constant binding.
    const res = await apiFetch(`${API_BASE}/events/stream`, {
      // Field/property in this shape.
      signal: controller.signal,
    });

    // Unsubscribed while fetch was in flight.
    if (controller.signal.aborted) return;

    // Auth loss — surface error; do not hammer reconnect.
    if (res.status === 401) {
      // Invoke helper or pass arguments.
      emitLiveError(new Event("error"));
      // Return computed result to caller.
      return;
    }

    // Transient HTTP / missing body — notify and reconnect with backoff.
    if (!res.ok || !res.body) {
      // Invoke helper or pass arguments.
      emitLiveError(new Event("error"));
      // Invoke helper or pass arguments.
      scheduleSharedLiveReconnect();
      // Return computed result to caller.
      return;
    }

    // Successful open resets backoff for the next failure.
    liveBackoffMs = 1000;
    // Local constant binding.
    const reader = res.body.getReader();
    // Local constant binding.
    const decoder = new TextDecoder();
    // Mutable local binding.
    let buffer = "";

    // Read until abort, last listener gone, or stream ends.
    while (!controller.signal.aborted && liveListeners.size > 0) {
      // Assign value for subsequent use.
      const { done, value } = await reader.read();
      // Conditional branch for this case.
      if (done) break;
      // Assign value for subsequent use.
      buffer += decoder.decode(value, { stream: true });
      // Assign value for subsequent use.
      buffer = parseSseChunk(buffer, emitLiveEvent);
    }

    // Unexpected EOF with listeners still present → reconnect.
    if (!controller.signal.aborted && liveListeners.size > 0) {
      // Invoke helper or pass arguments.
      emitLiveError(new Event("error"));
      // Invoke helper or pass arguments.
      scheduleSharedLiveReconnect();
    }
  // Invoke helper or pass arguments.
  } catch (err) {
    // Expected on unsubscribe / stopSharedLiveStream.
    if (controller.signal.aborted) return;
    // Conditional branch for this case.
    if (err instanceof DOMException && err.name === "AbortError") return;
    // Invoke helper or pass arguments.
    emitLiveError(new Event("error"));
    // Invoke helper or pass arguments.
    scheduleSharedLiveReconnect();
  // Open multi-line construct.
  } finally {
    // Only clear if we still own the controller (a newer start may have replaced it).
    if (liveController === controller) {
      // Assign value for subsequent use.
      liveController = null;
    }
    // Assign value for subsequent use.
    liveConnecting = false;
  }
}

/**
 * Subscribe to server-sent live events via a shared credentialed fetch stream.
 * @returns Unsubscribe; stops the shared stream when the last listener leaves.
 */
export function subscribeLiveEvents(
  // Arrow function / callback body.
  onEvent: (event: LiveEvent) => void,
  // Arrow function / callback body.
  onError?: (err: Event) => void,
// Arrow function / callback body.
): () => void {
  // Local constant binding.
  const listener: LiveListener = { onEvent, onError };
  // Invoke helper or pass arguments.
  liveListeners.add(listener);
  // Ensure the shared stream is running for this first (or additional) listener.
  void ensureSharedLiveStream();

  // Return computed result to caller.
  return () => {
    // Invoke helper or pass arguments.
    liveListeners.delete(listener);
    // Last subscriber left — tear down connection and backoff state.
    if (liveListeners.size === 0) {
      // Invoke helper or pass arguments.
      stopSharedLiveStream();
    }
  };
}
