import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  markReachable,
  markUnreachable,
  notify,
  resolveConn,
  scheduleBackoff,
  subscribeOffline,
  setDraining,
  isApiUnreachable,
  isDraining,
  triggerDrain,
} from "./connState";

const originalNavigator = globalThis.navigator;

function stubNavigatorOnline(online: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online },
  });
}

describe("initial connection state", () => {
  it("starts reachable and idle", () => {
    assert.equal(isApiUnreachable(), false);
    assert.equal(isDraining(), false);
  });
});

describe("resolveConn", () => {
  before(() => {
    stubNavigatorOnline(true);
  });

  after(() => {
    if (originalNavigator === undefined) {
      // @ts-expect-error restore Node without navigator
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
    setDraining(false);
    markReachable();
  });

  beforeEach(() => {
    stubNavigatorOnline(true);
    setDraining(false);
    markReachable();
  });

  it("returns explicit conn override", () => {
    stubNavigatorOnline(false);
    markUnreachable();
    setDraining(true);
    assert.equal(resolveConn("offline"), "offline");
    assert.equal(resolveConn("syncing"), "syncing");
    assert.equal(resolveConn("online"), "online");
  });

  it("returns offline when navigator is offline", () => {
    stubNavigatorOnline(false);
    assert.equal(resolveConn(), "offline");
  });

  it("returns unreachable when API is marked unreachable", () => {
    stubNavigatorOnline(true);
    markUnreachable();
    assert.equal(resolveConn(), "unreachable");
  });

  it("returns syncing when draining", () => {
    setDraining(true);
    assert.equal(resolveConn(), "syncing");
  });

  it("returns syncing when pending or sending > 0", () => {
    assert.equal(
      resolveConn(undefined, { pending: 1, sending: 0, conflict: 0, failed: 0 }),
      "syncing",
    );
    assert.equal(
      resolveConn(undefined, { pending: 0, sending: 1, conflict: 0, failed: 0 }),
      "syncing",
    );
  });

  it("returns online when idle", () => {
    assert.equal(resolveConn(), "online");
    assert.equal(
      resolveConn(undefined, { pending: 0, sending: 0, conflict: 2, failed: 1 }),
      "online",
    );
  });

  it("prefers offline navigator over unreachable", () => {
    stubNavigatorOnline(false);
    markUnreachable();
    assert.equal(resolveConn(), "offline");
  });

  it("works in SSR when navigator is absent", () => {
    try {
      // @ts-expect-error exercise a browser global missing in server rendering
      delete globalThis.navigator;
      assert.equal(resolveConn(), "online");
    } finally {
      if (originalNavigator === undefined) {
        // @ts-expect-error restore Node without navigator
        delete globalThis.navigator;
      } else {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: originalNavigator,
        });
      }
    }
  });
});

describe("offline backoff and subscriptions", () => {
  it("loads the queue drain lazily and invokes it", async () => {
    let loads = 0;
    let drains = 0;
    triggerDrain(async () => {
      loads += 1;
      return { drainQueue: () => { drains += 1; } };
    });
    await Promise.resolve();
    assert.equal(loads, 1);
    assert.equal(drains, 1);
  });

  it("clears the default system timer on successful I/O", () => {
    const originalWindow = globalThis.window;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let now = 0;
    const jobs = new Map<number, () => void>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      value: ((callback: () => void) => {
        const id = ++now;
        jobs.set(id, callback);
        return id;
      }) as typeof setTimeout,
    });
    Object.defineProperty(globalThis, "clearTimeout", {
      configurable: true,
      value: ((id: number) => { jobs.delete(id); }) as typeof clearTimeout,
    });
    try {
      scheduleBackoff();
      assert.equal(jobs.size, 1);
      markReachable();
      assert.equal(jobs.size, 0);
    } finally {
      markReachable();
      Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: originalSetTimeout });
      Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: originalClearTimeout });
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
    }
  });

  it("retries at each backoff boundary, coalesces timers, and resets after success", () => {
    const originalWindow = globalThis.window;
    let now = 0;
    let nextId = 1;
    const jobs = new Map<number, { due: number; callback: () => void }>();
    const delays: number[] = [];
    const timers = {
      setTimeout: ((callback: () => void, delay = 0) => {
        const id = nextId++;
        delays.push(delay);
        jobs.set(id, { due: now + delay, callback });
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: ((handle?: ReturnType<typeof setTimeout>) => {
        jobs.delete(handle as unknown as number);
      }) as typeof clearTimeout,
    };
    let drains = 0;
    const drain = () => { drains += 1; };

    const advance = (ms: number) => {
      const target = now + ms;
      while (true) {
        const next = [...jobs.entries()]
          .filter(([, job]) => job.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, job] = next;
        now = job.due;
        jobs.delete(id);
        job.callback();
      }
      now = target;
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    try {
      scheduleBackoff(drain, timers);
      scheduleBackoff(drain, timers);
      assert.deepEqual(delays, [2000]);
      advance(1999);
      assert.equal(drains, 0);
      advance(1);
      assert.equal(drains, 1);

      scheduleBackoff(drain, timers);
      advance(4999);
      assert.equal(drains, 1);
      advance(1);
      assert.equal(drains, 2);

      scheduleBackoff(drain, timers);
      advance(14999);
      assert.equal(drains, 2);
      advance(1);
      assert.equal(drains, 3);
      scheduleBackoff(drain, timers);
      advance(15000);
      assert.equal(drains, 4);
      assert.deepEqual(delays, [2000, 5000, 15000, 15000]);

      scheduleBackoff(drain, timers);
      assert.equal(jobs.size, 1);
      markReachable();
      assert.equal(jobs.size, 0, "successful I/O cancels pending retry");
      scheduleBackoff(drain, timers);
      assert.equal(delays.at(-1), 2000, "successful I/O resets the delay");
      advance(2000);
      assert.equal(drains, 5);
      markReachable();
    } finally {
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    }
  });

  it("does not schedule a browser timer during SSR", () => {
    const originalWindow = globalThis.window;
    let scheduled = 0;
    const timers = {
      setTimeout: ((callback: () => void, delay: number) => {
        void callback;
        void delay;
        scheduled += 1;
        return scheduled as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
    };
    try {
      // @ts-expect-error exercise server rendering with no window global
      delete globalThis.window;
      scheduleBackoff(() => {}, timers);
      assert.equal(scheduled, 0);
    } finally {
      markReachable();
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    }
  });

  it("drains on online and visible transitions, clears unreachable state, and unsubscribes", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;
    const makeTarget = () => {
      const listeners = new Map<string, EventListenerOrEventListenerObject>();
      const removed: string[] = [];
      return {
        listeners,
        removed,
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          if (listeners.get(type) === listener) listeners.delete(type);
          removed.push(type);
        },
      };
    };
    const windowTarget = makeTarget();
    const documentTarget = makeTarget();
    const retryTimerJobs = new Map<number, () => void>();
    let retryTimerId = 0;
    const retryTimers = {
      setTimeout: ((callback: () => void) => {
        const id = ++retryTimerId;
        retryTimerJobs.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: ((handle?: ReturnType<typeof setTimeout>) => {
        retryTimerJobs.delete(handle as unknown as number);
      }) as typeof clearTimeout,
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowTarget,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentTarget,
    });
    stubNavigatorOnline(true);

    let unsubscribe = () => {};
    let drains = 0;
    const stats = { pending: 2, sending: 1, conflict: 0, failed: 0 };
    const readStats = async () => stats;
    const snapshots: Array<{ conn: string; stats: unknown }> = [];
    const listener = (state: { conn: string; stats: import("./connState").QueueStats }) => {
      snapshots.push(state);
    };
    try {
      scheduleBackoff(() => { drains += 1; }, retryTimers);
      assert.equal(retryTimerJobs.size, 1);
      markUnreachable();
      unsubscribe = subscribeOffline(listener, () => { drains += 1; }, readStats);
      assert.deepEqual([...windowTarget.listeners.keys()], ["online", "offline"]);
      assert.deepEqual([...documentTarget.listeners.keys()], ["visibilitychange"]);
      await Promise.resolve();
      assert.equal(snapshots.at(-1)?.conn, "unreachable", "subscription publishes its current snapshot");

      const onOffline = windowTarget.listeners.get("offline") as () => void;
      stubNavigatorOnline(false);
      onOffline();
      await Promise.resolve();
      assert.equal(retryTimerJobs.size, 0, "going offline clears scheduled retries");
      assert.equal(resolveConn(), "offline");
      assert.equal(drains, 0, "going offline does not drain");
      assert.equal(snapshots.at(-1)?.conn, "offline", "offline event publishes state");
      assert.equal(resolveConn(), "offline", "offline clears stale API failure state");
      stubNavigatorOnline(true);
      assert.equal(resolveConn(), "online", "offline event clears the API-unreachable latch");

      const onOnline = windowTarget.listeners.get("online") as () => void;
      markUnreachable();
      stubNavigatorOnline(true);
      onOnline();
      await Promise.resolve();
      assert.equal(drains, 1, "online event starts the queue drain");
      assert.equal(resolveConn(), "online", "online clears the unreachable latch");
      assert.equal(snapshots.at(-1)?.conn, "syncing", "online event publishes syncing state");

      const onVisibility = documentTarget.listeners.get("visibilitychange") as () => void;
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      onVisibility();
      assert.equal(drains, 1, "hidden tab does not drain");
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      stubNavigatorOnline(false);
      onVisibility();
      assert.equal(drains, 1, "offline tab does not drain when made visible");
      stubNavigatorOnline(true);
      onVisibility();
      assert.equal(drains, 2, "visible online tab retries the queue");

      await notify("syncing", async () => stats);
      assert.deepEqual(snapshots.at(-1), { conn: "syncing", stats });

      const snapshotsBeforeUnsubscribe = snapshots.length;
      unsubscribe();
      assert.deepEqual(windowTarget.removed, ["online", "offline"]);
      assert.deepEqual(documentTarget.removed, ["visibilitychange"]);
      assert.equal(windowTarget.listeners.size, 0);
      assert.equal(documentTarget.listeners.size, 0);
      await notify("offline", async () => { throw new Error("stats unavailable"); });
      assert.equal(snapshots.length, snapshotsBeforeUnsubscribe, "unsubscribed listeners get no updates");
      await notify("offline", readStats);
      assert.equal(snapshots.length, snapshotsBeforeUnsubscribe, "unsubscribed listeners are removed from the pub/sub set");
    } finally {
      unsubscribe();
      markReachable();
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
      if (originalDocument === undefined) {
        // @ts-expect-error restore Node without a document global
        delete globalThis.document;
      } else {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      }
      if (originalNavigator === undefined) {
        // @ts-expect-error restore Node without a navigator global
        delete globalThis.navigator;
      } else {
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
      }
    }
  });
});
