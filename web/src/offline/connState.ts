/**
 * Connection mode + queue stats pub/sub for the offline banner.
 *
 * Separates browser offline from "API unreachable" (timeouts/5xx) so the UI can
 * show syncing vs unreachable, and schedules backoff drains without importing
 * `queueDrain` statically (avoids a cycle).
 */
export type ConnMode = "online" | "offline" | "syncing" | "unreachable";

// Export type alias for consumers.
export type QueueStats = {
  // Field/property in this shape.
  pending: number;
  // Field/property in this shape.
  sending: number;
  // Field/property in this shape.
  conflict: number;
  // Field/property in this shape.
  failed: number;
};

/** Escalating delays after network failures during drain. */
const BACKOFF_MS = [2000, 5000, 15000] as const;

// Local type alias shaping data.
type Listener = (state: { conn: ConnMode; stats: QueueStats }) => void;

// Local constant binding.
const listeners = new Set<Listener>();
// Mutable local binding.
let draining = false;
// Mutable local binding.
let apiUnreachable = false;
// Mutable local binding.
let backoffAttempt = 0;
// Mutable local binding.
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
// Mutable local binding.
let backoffKeepsCommandRetry = false;
// Mutable local binding.
let backoffDrain: () => void = () => {};
// Mutable local binding.
let clearBackoffTimer: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer);

// Local type alias shaping data.
type BackoffTimers = {
  // Field/property in this shape.
  setTimeout: (
    // Arrow function / callback body.
    callback: () => void,
    // Field/property in this shape.
    delay: number,
  // Arrow function / callback body.
  ) => ReturnType<typeof setTimeout>;
  // Arrow function / callback body.
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};
// Local constant binding.
const systemTimers: BackoffTimers = {
  // Arrow function / callback body.
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  // Arrow function / callback body.
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

/** Whether a drain loop is currently running (banner "syncing"). */
export function isDraining(): boolean {
  // Return computed result to caller.
  return draining;
}

/** Latch used by `queueDrain` so nested triggerDrain calls are no-ops. */
export function setDraining(value: boolean): void {
  // Assign value for subsequent use.
  draining = value;
}

/** True after timeouts/5xx until a successful markReachable. */
export function isApiUnreachable(): boolean {
  // Return computed result to caller.
  return apiUnreachable;
}

/**
 * Derive banner mode: explicit override wins; else offline → unreachable →
 * syncing (drain or pending/sending) → online.
 */
export function resolveConn(conn?: ConnMode, stats?: QueueStats): ConnMode {
  // Caller override (e.g. notify("offline") right after enqueue).
  if (conn) return conn;
  // Conditional branch for this case.
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  // Conditional branch for this case.
  if (apiUnreachable) return "unreachable";
  // Const arrow/function binding.
  const inflight = (stats?.pending ?? 0) + (stats?.sending ?? 0);
  // Conditional branch for this case.
  if (draining || inflight > 0) return "syncing";
  // Return computed result to caller.
  return "online";
}

/** Push `{ conn, stats }` to subscribers (stats loaded asynchronously). */
export function notify(
  // Field/property in this shape.
  conn?: ConnMode,
  // Arrow function / callback body.
  readStats: () => Promise<QueueStats> = async () => {
    // Dynamic import breaks the queueOps ↔ connState cycle.
    const { getQueueStats } = await import("./queueOps");
    // Return computed result to caller.
    return getQueueStats();
  },
// Open multi-line construct.
): Promise<void> {
  // Return computed result to caller.
  return readStats()
    // Arrow function / callback body.
    .then((stats) => {
      // Local constant binding.
      const mode = resolveConn(conn, stats);
      // Iterate collection / range.
      for (const listener of listeners) {
        // Invoke helper or pass arguments.
        listener({ conn: mode, stats });
      }
    })
    // Arrow function / callback body.
    .catch(() => {
      /* best-effort banner; IndexedDB may be missing in unit tests / SSR */
    });
}

/** Successful I/O cancels network backoff, but cannot settle a queued command. */
export function markReachable(options: { cancelCommandRetry?: boolean } = {}) {
  // Assign value for subsequent use.
  apiUnreachable = false;
  // Conditional branch for this case.
  if (backoffKeepsCommandRetry && !options.cancelCommandRetry) return;
  // Assign value for subsequent use.
  backoffAttempt = 0;
  // Conditional branch for this case.
  if (backoffTimer !== null) {
    // Invoke helper or pass arguments.
    clearBackoffTimer(backoffTimer);
    // Assign value for subsequent use.
    backoffTimer = null;
  }
  // Assign value for subsequent use.
  backoffKeepsCommandRetry = false;
}

/** Browser is online but API calls are timing out / failing at the network layer. */
export function markUnreachable() {
  // Assign value for subsequent use.
  apiUnreachable = true;
  // Invoke helper or pass arguments.
  notify("unreachable");
}

/** Lazy to avoid static cycle with queueDrain; loader is injectable for tests. */
export function triggerDrain(
  // Arrow function / callback body.
  loadQueueDrain: () => Promise<{ drainQueue: () => void | Promise<void> }> = () => import("./queueDrain"),
// Open multi-line construct.
): void {
  // Fire-and-forget async/side effect.
  void loadQueueDrain().then((m) => m.drainQueue());
}

/** One scheduled drain retry; stacks attempt index up to the last BACKOFF_MS slot. */
export function scheduleBackoff(
  // Arrow function / callback body.
  drain: () => void = triggerDrain,
  // Field/property in this shape.
  timers: BackoffTimers = systemTimers,
  // Field/property in this shape.
  options: { keepOnReachable?: boolean } = {},
// Open multi-line construct.
) {
  // Only one timer; SSR / non-window skips scheduling.
  if (typeof window === "undefined") return;
  // Conditional branch for this case.
  if (backoffTimer !== null) {
    // Conditional branch for this case.
    if (options.keepOnReachable) {
      // Assign value for subsequent use.
      backoffKeepsCommandRetry = true;
      // Assign value for subsequent use.
      backoffDrain = drain;
    }
    // Return computed result to caller.
    return;
  }
  // Assign value for subsequent use.
  backoffKeepsCommandRetry = options.keepOnReachable ?? false;
  // Assign value for subsequent use.
  backoffDrain = drain;
  // Local constant binding.
  const delay = BACKOFF_MS[Math.min(backoffAttempt, BACKOFF_MS.length - 1)]!;
  // Assign value for subsequent use.
  backoffAttempt += 1;
  // Assign value for subsequent use.
  clearBackoffTimer = timers.clearTimeout;
  // Arrow function / callback body.
  backoffTimer = timers.setTimeout(() => {
    // Assign value for subsequent use.
    backoffTimer = null;
    // Assign value for subsequent use.
    backoffKeepsCommandRetry = false;
    // Invoke helper or pass arguments.
    backoffDrain();
  // Close multi-line construct with trailing syntax.
  }, delay);
}

/**
 * Subscribe to conn/stats updates and wire browser online/offline/visibility
 * so returning to the tab retries the outbox.
 */
export function subscribeOffline(
  // Field/property in this shape.
  listener: Listener,
  // Arrow function / callback body.
  drain: () => void = triggerDrain,
  // Arrow function / callback body.
  readStats?: () => Promise<QueueStats>,
// Arrow function / callback body.
): () => void {
  // Invoke helper or pass arguments.
  listeners.add(listener);
  // Immediate snapshot so the banner does not wait for the next event.
  void notify(undefined, readStats);
  // Const arrow/function binding.
  const onOnline = () => {
    // Invoke helper or pass arguments.
    markReachable();
    // Fire-and-forget async/side effect.
    void notify("syncing", readStats);
    // Invoke helper or pass arguments.
    drain();
  };
  // Const arrow/function binding.
  const onOffline = () => {
    // Clear unreachable so we show clean "offline" rather than stale API error.
    markReachable({ cancelCommandRetry: true });
    // Assign value for subsequent use.
    apiUnreachable = false;
    // Fire-and-forget async/side effect.
    void notify("offline", readStats);
  };
  // Const arrow/function binding.
  const onVis = () => {
    // Returning to a visible online tab — retry any pending outbox work.
    if (document.visibilityState === "visible" && navigator.onLine) {
      // Invoke helper or pass arguments.
      drain();
    }
  };
  // Invoke helper or pass arguments.
  window.addEventListener("online", onOnline);
  // Invoke helper or pass arguments.
  window.addEventListener("offline", onOffline);
  // Invoke helper or pass arguments.
  document.addEventListener("visibilitychange", onVis);
  // Return computed result to caller.
  return () => {
    // Invoke helper or pass arguments.
    listeners.delete(listener);
    // Invoke helper or pass arguments.
    window.removeEventListener("online", onOnline);
    // Invoke helper or pass arguments.
    window.removeEventListener("offline", onOffline);
    // Invoke helper or pass arguments.
    document.removeEventListener("visibilitychange", onVis);
  };
}
