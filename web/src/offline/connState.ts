/**
 * Connection mode + queue stats pub/sub for the offline banner.
 *
 * Separates browser offline from "API unreachable" (timeouts/5xx) so the UI can
 * show syncing vs unreachable, and schedules backoff drains without importing
 * `queueDrain` statically (avoids a cycle).
 */
export type ConnMode = "online" | "offline" | "syncing" | "unreachable";

export type QueueStats = {
  pending: number;
  sending: number;
  conflict: number;
  failed: number;
};

/** Escalating delays after network failures during drain. */
const BACKOFF_MS = [2000, 5000, 15000] as const;

type Listener = (state: { conn: ConnMode; stats: QueueStats }) => void;

const listeners = new Set<Listener>();
let draining = false;
let apiUnreachable = false;
let backoffAttempt = 0;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let clearBackoffTimer: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer);

type BackoffTimers = {
  setTimeout: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};
const systemTimers: BackoffTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

/** Whether a drain loop is currently running (banner "syncing"). */
export function isDraining(): boolean {
  return draining;
}

/** Latch used by `queueDrain` so nested triggerDrain calls are no-ops. */
export function setDraining(value: boolean): void {
  draining = value;
}

/** True after timeouts/5xx until a successful markReachable. */
export function isApiUnreachable(): boolean {
  return apiUnreachable;
}

/**
 * Derive banner mode: explicit override wins; else offline → unreachable →
 * syncing (drain or pending/sending) → online.
 */
export function resolveConn(conn?: ConnMode, stats?: QueueStats): ConnMode {
  // Caller override (e.g. notify("offline") right after enqueue).
  if (conn) return conn;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  if (apiUnreachable) return "unreachable";
  const inflight = (stats?.pending ?? 0) + (stats?.sending ?? 0);
  if (draining || inflight > 0) return "syncing";
  return "online";
}

/** Push `{ conn, stats }` to subscribers (stats loaded asynchronously). */
export function notify(
  conn?: ConnMode,
  readStats: () => Promise<QueueStats> = async () => {
    // Dynamic import breaks the queueOps ↔ connState cycle.
    const { getQueueStats } = await import("./queueOps");
    return getQueueStats();
  },
): Promise<void> {
  return readStats()
    .then((stats) => {
      const mode = resolveConn(conn, stats);
      for (const listener of listeners) {
        listener({ conn: mode, stats });
      }
    })
    .catch(() => {
      /* best-effort banner; IndexedDB may be missing in unit tests / SSR */
    });
}

/** Clear unreachable flag and cancel pending backoff (successful I/O). */
export function markReachable() {
  apiUnreachable = false;
  backoffAttempt = 0;
  if (backoffTimer !== null) {
    clearBackoffTimer(backoffTimer);
    backoffTimer = null;
  }
}

/** Browser is online but API calls are timing out / failing at the network layer. */
export function markUnreachable() {
  apiUnreachable = true;
  notify("unreachable");
}

/** Lazy to avoid static cycle with queueDrain; loader is injectable for tests. */
export function triggerDrain(
  loadQueueDrain: () => Promise<{ drainQueue: () => void | Promise<void> }> = () => import("./queueDrain"),
): void {
  void loadQueueDrain().then((m) => m.drainQueue());
}

/** One scheduled drain retry; stacks attempt index up to the last BACKOFF_MS slot. */
export function scheduleBackoff(
  drain: () => void = triggerDrain,
  timers: BackoffTimers = systemTimers,
) {
  // Only one timer; SSR / non-window skips scheduling.
  if (backoffTimer !== null || typeof window === "undefined") return;
  const delay = BACKOFF_MS[Math.min(backoffAttempt, BACKOFF_MS.length - 1)]!;
  backoffAttempt += 1;
  clearBackoffTimer = timers.clearTimeout;
  backoffTimer = timers.setTimeout(() => {
    backoffTimer = null;
    drain();
  }, delay);
}

/**
 * Subscribe to conn/stats updates and wire browser online/offline/visibility
 * so returning to the tab retries the outbox.
 */
export function subscribeOffline(
  listener: Listener,
  drain: () => void = triggerDrain,
  readStats?: () => Promise<QueueStats>,
): () => void {
  listeners.add(listener);
  // Immediate snapshot so the banner does not wait for the next event.
  void notify(undefined, readStats);
  const onOnline = () => {
    markReachable();
    void notify("syncing", readStats);
    drain();
  };
  const onOffline = () => {
    // Clear unreachable so we show clean "offline" rather than stale API error.
    markReachable();
    apiUnreachable = false;
    void notify("offline", readStats);
  };
  const onVis = () => {
    // Returning to a visible online tab — retry any pending outbox work.
    if (document.visibilityState === "visible" && navigator.onLine) {
      drain();
    }
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVis);
  };
}
