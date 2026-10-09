import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type LiveEventType =
  | "location.changed"
  | "cleaning.changed"
  | "ticket.changed"
  | "settings.changed"
  | "people.changed"
  | "notification.changed"
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
  "notification.changed",
]);

function parseSseChunk(
  buffer: string,
  onEvent: (event: LiveEvent) => void,
): string {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    let eventType = "message";
    const dataLines: string[] = [];
    for (const rawLine of part.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (!LIVE_EVENT_TYPES.has(eventType)) continue;
    let data: Record<string, unknown> = {};
    const rawData = dataLines.join("\n");
    if (rawData) {
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

/** Short-lived SSE ticket for EventSource clients (prefer Bearer fetch stream). */
export async function fetchSseTicket(): Promise<{
  token: string;
  expiresIn: number;
}> {
  const res = await apiFetch(`${API_BASE}/events/ticket`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
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

function emitLiveEvent(event: LiveEvent) {
  for (const listener of [...liveListeners]) {
    try {
      listener.onEvent(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

function emitLiveError(err: Event) {
  for (const listener of [...liveListeners]) {
    try {
      listener.onError?.(err);
    } catch {
      /* ignore */
    }
  }
}

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

function scheduleSharedLiveReconnect() {
  if (liveListeners.size === 0) return;
  if (liveReconnectTimer) return;
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    void ensureSharedLiveStream();
  }, liveBackoffMs);
  liveBackoffMs = Math.min(liveBackoffMs * 2, LIVE_MAX_BACKOFF_MS);
}

async function ensureSharedLiveStream() {
  if (liveListeners.size === 0 || liveConnecting) return;
  if (liveController && !liveController.signal.aborted) return;

  liveConnecting = true;
  const controller = new AbortController();
  liveController = controller;

  try {
    const res = await apiFetch(`${API_BASE}/events/stream`, {
      signal: controller.signal,
    });

    if (controller.signal.aborted) return;

    if (res.status === 401) {
      emitLiveError(new Event("error"));
      return;
    }

    if (!res.ok || !res.body) {
      emitLiveError(new Event("error"));
      scheduleSharedLiveReconnect();
      return;
    }

    liveBackoffMs = 1000;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!controller.signal.aborted && liveListeners.size > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, emitLiveEvent);
    }

    if (!controller.signal.aborted && liveListeners.size > 0) {
      emitLiveError(new Event("error"));
      scheduleSharedLiveReconnect();
    }
  } catch (err) {
    if (controller.signal.aborted) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    emitLiveError(new Event("error"));
    scheduleSharedLiveReconnect();
  } finally {
    if (liveController === controller) {
      liveController = null;
    }
    liveConnecting = false;
  }
}

/** Subscribe to server-sent live events via a shared credentialed fetch stream. */
export function subscribeLiveEvents(
  onEvent: (event: LiveEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const listener: LiveListener = { onEvent, onError };
  liveListeners.add(listener);
  void ensureSharedLiveStream();

  return () => {
    liveListeners.delete(listener);
    if (liveListeners.size === 0) {
      stopSharedLiveStream();
    }
  };
}
