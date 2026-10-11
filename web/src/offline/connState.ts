export type ConnMode = "online" | "offline" | "syncing" | "unreachable";

export type QueueStats = {
  pending: number;
  sending: number;
  conflict: number;
  failed: number;
};

const BACKOFF_MS = [2000, 5000, 15000] as const;

type Listener = (state: { conn: ConnMode; stats: QueueStats }) => void;

const listeners = new Set<Listener>();
let draining = false;
let apiUnreachable = false;
let backoffAttempt = 0;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

export function isDraining(): boolean {
  return draining;
}

export function setDraining(value: boolean): void {
  draining = value;
}

export function isApiUnreachable(): boolean {
  return apiUnreachable;
}

export function resolveConn(conn?: ConnMode, stats?: QueueStats): ConnMode {
  if (conn) return conn;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  if (apiUnreachable) return "unreachable";
  const inflight = (stats?.pending ?? 0) + (stats?.sending ?? 0);
  if (draining || inflight > 0) return "syncing";
  return "online";
}

export function notify(conn?: ConnMode) {
  void import("./queueOps").then(({ getQueueStats }) => {
    void getQueueStats().then((stats) => {
      const mode = resolveConn(conn, stats);
      for (const listener of listeners) {
        listener({ conn: mode, stats });
      }
    });
  });
}

export function markReachable() {
  apiUnreachable = false;
  backoffAttempt = 0;
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

export function markUnreachable() {
  apiUnreachable = true;
  notify("unreachable");
}

/** Lazy to avoid static cycle with queueDrain. */
export function triggerDrain(): void {
  void import("./queueDrain").then((m) => m.drainQueue());
}

export function scheduleBackoff() {
  if (backoffTimer || typeof window === "undefined") return;
  const delay = BACKOFF_MS[Math.min(backoffAttempt, BACKOFF_MS.length - 1)]!;
  backoffAttempt += 1;
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    triggerDrain();
  }, delay);
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  notify();
  const onOnline = () => {
    markReachable();
    notify("syncing");
    triggerDrain();
  };
  const onOffline = () => {
    markReachable();
    apiUnreachable = false;
    notify("offline");
  };
  const onVis = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      triggerDrain();
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
