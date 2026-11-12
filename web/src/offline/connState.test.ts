// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { after, before, beforeEach, describe, it } from "node:test";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  markReachable,
  // List item in import/export/params.
  markUnreachable,
  // List item in import/export/params.
  notify,
  // List item in import/export/params.
  resolveConn,
  // List item in import/export/params.
  scheduleBackoff,
  // List item in import/export/params.
  subscribeOffline,
  // List item in import/export/params.
  setDraining,
  // List item in import/export/params.
  isApiUnreachable,
  // List item in import/export/params.
  isDraining,
  // List item in import/export/params.
  triggerDrain,
// Close multi-line construct with trailing syntax.
} from "./connState";

// Local constant binding.
const originalNavigator = globalThis.navigator;

// Function definition.
function stubNavigatorOnline(online: boolean): void {
  // Open multi-line construct.
  Object.defineProperty(globalThis, "navigator", {
    // Field/property in this shape.
    configurable: true,
    // Field/property in this shape.
    value: { onLine: online },
  });
}

// Group related unit tests.
describe("initial connection state", () => {
  // Unit test case.
  it("starts reachable and idle", () => {
    // Assert expected test outcome.
    assert.equal(isApiUnreachable(), false);
    // Assert expected test outcome.
    assert.equal(isDraining(), false);
  });
});

// Group related unit tests.
describe("resolveConn", () => {
  // Test lifecycle hook.
  before(() => {
    // Invoke helper or pass arguments.
    stubNavigatorOnline(true);
  });

  // Test lifecycle hook.
  after(() => {
    // Conditional branch for this case.
    if (originalNavigator === undefined) {
      // @ts-expect-error restore Node without navigator
      delete globalThis.navigator;
    // Open multi-line construct.
    } else {
      // Open multi-line construct.
      Object.defineProperty(globalThis, "navigator", {
        // Field/property in this shape.
        configurable: true,
        // Field/property in this shape.
        value: originalNavigator,
      });
    }
    // Invoke helper or pass arguments.
    setDraining(false);
    // Invoke helper or pass arguments.
    markReachable();
  });

  // Test lifecycle hook.
  beforeEach(() => {
    // Invoke helper or pass arguments.
    stubNavigatorOnline(true);
    // Invoke helper or pass arguments.
    setDraining(false);
    // Invoke helper or pass arguments.
    markReachable();
  });

  // Unit test case.
  it("returns explicit conn override", () => {
    // Invoke helper or pass arguments.
    stubNavigatorOnline(false);
    // Invoke helper or pass arguments.
    markUnreachable();
    // Invoke helper or pass arguments.
    setDraining(true);
    // Assert expected test outcome.
    assert.equal(resolveConn("offline"), "offline");
    // Assert expected test outcome.
    assert.equal(resolveConn("syncing"), "syncing");
    // Assert expected test outcome.
    assert.equal(resolveConn("online"), "online");
  });

  // Unit test case.
  it("returns offline when navigator is offline", () => {
    // Invoke helper or pass arguments.
    stubNavigatorOnline(false);
    // Assert expected test outcome.
    assert.equal(resolveConn(), "offline");
  });

  // Unit test case.
  it("returns unreachable when API is marked unreachable", () => {
    // Invoke helper or pass arguments.
    stubNavigatorOnline(true);
    // Invoke helper or pass arguments.
    markUnreachable();
    // Assert expected test outcome.
    assert.equal(resolveConn(), "unreachable");
  });

  // Unit test case.
  it("returns syncing when draining", () => {
    // Invoke helper or pass arguments.
    setDraining(true);
    // Assert expected test outcome.
    assert.equal(resolveConn(), "syncing");
  });

  // Unit test case.
  it("returns syncing when pending or sending > 0", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      resolveConn(undefined, { pending: 1, sending: 0, conflict: 0, failed: 0 }),
      // Continue multi-line list/arguments.
      "syncing",
    );
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      resolveConn(undefined, { pending: 0, sending: 1, conflict: 0, failed: 0 }),
      // Continue multi-line list/arguments.
      "syncing",
    );
  });

  // Unit test case.
  it("returns online when idle", () => {
    // Assert expected test outcome.
    assert.equal(resolveConn(), "online");
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      resolveConn(undefined, { pending: 0, sending: 0, conflict: 2, failed: 1 }),
      // Continue multi-line list/arguments.
      "online",
    );
  });

  // Unit test case.
  it("prefers offline navigator over unreachable", () => {
    // Invoke helper or pass arguments.
    stubNavigatorOnline(false);
    // Invoke helper or pass arguments.
    markUnreachable();
    // Assert expected test outcome.
    assert.equal(resolveConn(), "offline");
  });

  // Unit test case.
  it("works in SSR when navigator is absent", () => {
    // Guard fallible work.
    try {
      // @ts-expect-error exercise a browser global missing in server rendering
      delete globalThis.navigator;
      // Assert expected test outcome.
      assert.equal(resolveConn(), "online");
    // Open multi-line construct.
    } finally {
      // Conditional branch for this case.
      if (originalNavigator === undefined) {
        // @ts-expect-error restore Node without navigator
        delete globalThis.navigator;
      // Open multi-line construct.
      } else {
        // Open multi-line construct.
        Object.defineProperty(globalThis, "navigator", {
          // Field/property in this shape.
          configurable: true,
          // Field/property in this shape.
          value: originalNavigator,
        });
      }
    }
  });
});

// Group related unit tests.
describe("offline backoff and subscriptions", () => {
  // Unit test case.
  it("loads the queue drain lazily and invokes it", async () => {
    // Mutable local binding.
    let loads = 0;
    // Mutable local binding.
    let drains = 0;
    // Arrow function / callback body.
    triggerDrain(async () => {
      // Assign value for subsequent use.
      loads += 1;
      // Return computed result to caller.
      return { drainQueue: () => { drains += 1; } };
    });
    // Await async work before continuing.
    await Promise.resolve();
    // Assert expected test outcome.
    assert.equal(loads, 1);
    // Assert expected test outcome.
    assert.equal(drains, 1);
  });

  // Unit test case.
  it("clears the default system timer on successful I/O", () => {
    // Local constant binding.
    const originalWindow = globalThis.window;
    // Local constant binding.
    const originalSetTimeout = globalThis.setTimeout;
    // Local constant binding.
    const originalClearTimeout = globalThis.clearTimeout;
    // Mutable local binding.
    let now = 0;
    // Local constant binding.
    const jobs = new Map<number, () => void>();
    // Invoke helper or pass arguments.
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    // Open multi-line construct.
    Object.defineProperty(globalThis, "setTimeout", {
      // Field/property in this shape.
      configurable: true,
      // Arrow function / callback body.
      value: ((callback: () => void) => {
        // Local constant binding.
        const id = ++now;
        // Invoke helper or pass arguments.
        jobs.set(id, callback);
        // Return computed result to caller.
        return id;
      // Continue multi-line list/arguments.
      }) as typeof setTimeout,
    });
    // Open multi-line construct.
    Object.defineProperty(globalThis, "clearTimeout", {
      // Field/property in this shape.
      configurable: true,
      // Arrow function / callback body.
      value: ((id: number) => { jobs.delete(id); }) as typeof clearTimeout,
    });
    // Guard fallible work.
    try {
      // Invoke helper or pass arguments.
      scheduleBackoff();
      // Assert expected test outcome.
      assert.equal(jobs.size, 1);
      // Invoke helper or pass arguments.
      markReachable();
      // Assert expected test outcome.
      assert.equal(jobs.size, 0);
    // Open multi-line construct.
    } finally {
      // Invoke helper or pass arguments.
      markReachable();
      // Invoke helper or pass arguments.
      Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: originalSetTimeout });
      // Invoke helper or pass arguments.
      Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: originalClearTimeout });
      // Conditional branch for this case.
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      // Open multi-line construct.
      } else {
        // Invoke helper or pass arguments.
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
    }
  });

  // Unit test case.
  it("retries at each backoff boundary, coalesces timers, and resets after success", () => {
    // Local constant binding.
    const originalWindow = globalThis.window;
    // Mutable local binding.
    let now = 0;
    // Mutable local binding.
    let nextId = 1;
    // Local constant binding.
    const jobs = new Map<number, { due: number; callback: () => void }>();
    // Local constant binding.
    const delays: number[] = [];
    // Local constant binding.
    const timers = {
      // Arrow function / callback body.
      setTimeout: ((callback: () => void, delay = 0) => {
        // Local constant binding.
        const id = nextId++;
        // Invoke helper or pass arguments.
        delays.push(delay);
        // Invoke helper or pass arguments.
        jobs.set(id, { due: now + delay, callback });
        // Return computed result to caller.
        return id as unknown as ReturnType<typeof setTimeout>;
      // Continue multi-line list/arguments.
      }) as typeof setTimeout,
      // Arrow function / callback body.
      clearTimeout: ((handle?: ReturnType<typeof setTimeout>) => {
        // Invoke helper or pass arguments.
        jobs.delete(handle as unknown as number);
      // Continue multi-line list/arguments.
      }) as typeof clearTimeout,
    };
    // Mutable local binding.
    let drains = 0;
    // Const arrow/function binding.
    const drain = () => { drains += 1; };

    // Const arrow/function binding.
    const advance = (ms: number) => {
      // Local constant binding.
      const target = now + ms;
      // Loop while condition holds.
      while (true) {
        // Local constant binding.
        const next = [...jobs.entries()]
          // Arrow function / callback body.
          .filter(([, job]) => job.due <= target)
          // Arrow function / callback body.
          .sort((a, b) => a[1].due - b[1].due)[0];
        // Conditional branch for this case.
        if (!next) break;
        // Assign value for subsequent use.
        const [id, job] = next;
        // Assign value for subsequent use.
        now = job.due;
        // Invoke helper or pass arguments.
        jobs.delete(id);
        // Invoke helper or pass arguments.
        job.callback();
      }
      // Assign value for subsequent use.
      now = target;
    };

    // Open multi-line construct.
    Object.defineProperty(globalThis, "window", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: {},
    });

    // Guard fallible work.
    try {
      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Assert expected test outcome.
      assert.deepEqual(delays, [2000]);
      // Invoke helper or pass arguments.
      advance(1999);
      // Assert expected test outcome.
      assert.equal(drains, 0);
      // Invoke helper or pass arguments.
      advance(1);
      // Assert expected test outcome.
      assert.equal(drains, 1);

      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Invoke helper or pass arguments.
      advance(4999);
      // Assert expected test outcome.
      assert.equal(drains, 1);
      // Invoke helper or pass arguments.
      advance(1);
      // Assert expected test outcome.
      assert.equal(drains, 2);

      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Invoke helper or pass arguments.
      advance(14999);
      // Assert expected test outcome.
      assert.equal(drains, 2);
      // Invoke helper or pass arguments.
      advance(1);
      // Assert expected test outcome.
      assert.equal(drains, 3);
      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Invoke helper or pass arguments.
      advance(15000);
      // Assert expected test outcome.
      assert.equal(drains, 4);
      // Assert expected test outcome.
      assert.deepEqual(delays, [2000, 5000, 15000, 15000]);

      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Assert expected test outcome.
      assert.equal(jobs.size, 1);
      // Invoke helper or pass arguments.
      markReachable();
      // Assert expected test outcome.
      assert.equal(jobs.size, 0, "successful I/O cancels pending retry");
      // Invoke helper or pass arguments.
      scheduleBackoff(drain, timers);
      // Assert expected test outcome.
      assert.equal(delays.at(-1), 2000, "successful I/O resets the delay");
      // Invoke helper or pass arguments.
      advance(2000);
      // Assert expected test outcome.
      assert.equal(drains, 5);
      // Invoke helper or pass arguments.
      markReachable();
    // Open multi-line construct.
    } finally {
      // Conditional branch for this case.
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      // Open multi-line construct.
      } else {
        // Open multi-line construct.
        Object.defineProperty(globalThis, "window", {
          // Field/property in this shape.
          configurable: true,
          // Field/property in this shape.
          value: originalWindow,
        });
      }
    }
  });

  // Unit test case.
  it("does not schedule a browser timer during SSR", () => {
    // Local constant binding.
    const originalWindow = globalThis.window;
    // Mutable local binding.
    let scheduled = 0;
    // Local constant binding.
    const timers = {
      // Arrow function / callback body.
      setTimeout: ((callback: () => void, delay: number) => {
        // Fire-and-forget async/side effect.
        void callback;
        // Fire-and-forget async/side effect.
        void delay;
        // Assign value for subsequent use.
        scheduled += 1;
        // Return computed result to caller.
        return scheduled as unknown as ReturnType<typeof setTimeout>;
      // Continue multi-line list/arguments.
      }) as typeof setTimeout,
      // Arrow function / callback body.
      clearTimeout: (() => {}) as typeof clearTimeout,
    };
    // Guard fallible work.
    try {
      // @ts-expect-error exercise server rendering with no window global
      delete globalThis.window;
      // Arrow function / callback body.
      scheduleBackoff(() => {}, timers);
      // Assert expected test outcome.
      assert.equal(scheduled, 0);
    // Open multi-line construct.
    } finally {
      // Invoke helper or pass arguments.
      markReachable();
      // Conditional branch for this case.
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      // Open multi-line construct.
      } else {
        // Open multi-line construct.
        Object.defineProperty(globalThis, "window", {
          // Field/property in this shape.
          configurable: true,
          // Field/property in this shape.
          value: originalWindow,
        });
      }
    }
  });

  // Unit test case.
  it("drains on online and visible transitions, clears unreachable state, and unsubscribes", async () => {
    // Local constant binding.
    const originalWindow = globalThis.window;
    // Local constant binding.
    const originalDocument = globalThis.document;
    // Local constant binding.
    const originalNavigator = globalThis.navigator;
    // Const arrow/function binding.
    const makeTarget = () => {
      // Local constant binding.
      const listeners = new Map<string, EventListenerOrEventListenerObject>();
      // Local constant binding.
      const removed: string[] = [];
      // Return computed result to caller.
      return {
        // List item in import/export/params.
        listeners,
        // List item in import/export/params.
        removed,
        // Invoke helper or pass arguments.
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          // Invoke helper or pass arguments.
          listeners.set(type, listener);
        },
        // Invoke helper or pass arguments.
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          // Conditional branch for this case.
          if (listeners.get(type) === listener) listeners.delete(type);
          // Invoke helper or pass arguments.
          removed.push(type);
        },
      };
    };
    // Local constant binding.
    const windowTarget = makeTarget();
    // Local constant binding.
    const documentTarget = makeTarget();
    // Local constant binding.
    const retryTimerJobs = new Map<number, () => void>();
    // Mutable local binding.
    let retryTimerId = 0;
    // Local constant binding.
    const retryTimers = {
      // Arrow function / callback body.
      setTimeout: ((callback: () => void) => {
        // Local constant binding.
        const id = ++retryTimerId;
        // Invoke helper or pass arguments.
        retryTimerJobs.set(id, callback);
        // Return computed result to caller.
        return id as unknown as ReturnType<typeof setTimeout>;
      // Continue multi-line list/arguments.
      }) as typeof setTimeout,
      // Arrow function / callback body.
      clearTimeout: ((handle?: ReturnType<typeof setTimeout>) => {
        // Invoke helper or pass arguments.
        retryTimerJobs.delete(handle as unknown as number);
      // Continue multi-line list/arguments.
      }) as typeof clearTimeout,
    };
    // Open multi-line construct.
    Object.defineProperty(globalThis, "window", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: windowTarget,
    });
    // Open multi-line construct.
    Object.defineProperty(globalThis, "document", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: documentTarget,
    });
    // Invoke helper or pass arguments.
    stubNavigatorOnline(true);

    // Mutable local binding.
    let unsubscribe = () => {};
    // Mutable local binding.
    let drains = 0;
    // Local constant binding.
    const stats = { pending: 2, sending: 1, conflict: 0, failed: 0 };
    // Async const function binding.
    const readStats = async () => stats;
    // Local constant binding.
    const snapshots: Array<{ conn: string; stats: unknown }> = [];
    // Const arrow/function binding.
    const listener = (state: { conn: string; stats: import("./connState").QueueStats }) => {
      // Invoke helper or pass arguments.
      snapshots.push(state);
    };
    // Guard fallible work.
    try {
      // Arrow function / callback body.
      scheduleBackoff(() => { drains += 1; }, retryTimers);
      // Assert expected test outcome.
      assert.equal(retryTimerJobs.size, 1);
      // Invoke helper or pass arguments.
      markUnreachable();
      // Arrow function / callback body.
      unsubscribe = subscribeOffline(listener, () => { drains += 1; }, readStats);
      // Assert expected test outcome.
      assert.deepEqual([...windowTarget.listeners.keys()], ["online", "offline"]);
      // Assert expected test outcome.
      assert.deepEqual([...documentTarget.listeners.keys()], ["visibilitychange"]);
      // Await async work before continuing.
      await Promise.resolve();
      // Assert expected test outcome.
      assert.equal(snapshots.at(-1)?.conn, "unreachable", "subscription publishes its current snapshot");

      // Local constant binding.
      const onOffline = windowTarget.listeners.get("offline") as () => void;
      // Invoke helper or pass arguments.
      stubNavigatorOnline(false);
      // Invoke helper or pass arguments.
      onOffline();
      // Await async work before continuing.
      await Promise.resolve();
      // Assert expected test outcome.
      assert.equal(retryTimerJobs.size, 0, "going offline clears scheduled retries");
      // Assert expected test outcome.
      assert.equal(resolveConn(), "offline");
      // Assert expected test outcome.
      assert.equal(drains, 0, "going offline does not drain");
      // Assert expected test outcome.
      assert.equal(snapshots.at(-1)?.conn, "offline", "offline event publishes state");
      // Assert expected test outcome.
      assert.equal(resolveConn(), "offline", "offline clears stale API failure state");
      // Invoke helper or pass arguments.
      stubNavigatorOnline(true);
      // Assert expected test outcome.
      assert.equal(resolveConn(), "online", "offline event clears the API-unreachable latch");

      // Local constant binding.
      const onOnline = windowTarget.listeners.get("online") as () => void;
      // Invoke helper or pass arguments.
      markUnreachable();
      // Invoke helper or pass arguments.
      stubNavigatorOnline(true);
      // Invoke helper or pass arguments.
      onOnline();
      // Await async work before continuing.
      await Promise.resolve();
      // Assert expected test outcome.
      assert.equal(drains, 1, "online event starts the queue drain");
      // Assert expected test outcome.
      assert.equal(resolveConn(), "online", "online clears the unreachable latch");
      // Assert expected test outcome.
      assert.equal(snapshots.at(-1)?.conn, "syncing", "online event publishes syncing state");

      // Local constant binding.
      const onVisibility = documentTarget.listeners.get("visibilitychange") as () => void;
      // Invoke helper or pass arguments.
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      // Invoke helper or pass arguments.
      onVisibility();
      // Assert expected test outcome.
      assert.equal(drains, 1, "hidden tab does not drain");
      // Invoke helper or pass arguments.
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      // Invoke helper or pass arguments.
      stubNavigatorOnline(false);
      // Invoke helper or pass arguments.
      onVisibility();
      // Assert expected test outcome.
      assert.equal(drains, 1, "offline tab does not drain when made visible");
      // Invoke helper or pass arguments.
      stubNavigatorOnline(true);
      // Invoke helper or pass arguments.
      onVisibility();
      // Assert expected test outcome.
      assert.equal(drains, 2, "visible online tab retries the queue");

      // Await async work before continuing.
      await notify("syncing", async () => stats);
      // Assert expected test outcome.
      assert.deepEqual(snapshots.at(-1), { conn: "syncing", stats });

      // Local constant binding.
      const snapshotsBeforeUnsubscribe = snapshots.length;
      // Invoke helper or pass arguments.
      unsubscribe();
      // Assert expected test outcome.
      assert.deepEqual(windowTarget.removed, ["online", "offline"]);
      // Assert expected test outcome.
      assert.deepEqual(documentTarget.removed, ["visibilitychange"]);
      // Assert expected test outcome.
      assert.equal(windowTarget.listeners.size, 0);
      // Assert expected test outcome.
      assert.equal(documentTarget.listeners.size, 0);
      // Await async work before continuing.
      await notify("offline", async () => { throw new Error("stats unavailable"); });
      // Assert expected test outcome.
      assert.equal(snapshots.length, snapshotsBeforeUnsubscribe, "unsubscribed listeners get no updates");
      // Await async work before continuing.
      await notify("offline", readStats);
      // Assert expected test outcome.
      assert.equal(snapshots.length, snapshotsBeforeUnsubscribe, "unsubscribed listeners are removed from the pub/sub set");
    // Open multi-line construct.
    } finally {
      // Invoke helper or pass arguments.
      unsubscribe();
      // Invoke helper or pass arguments.
      markReachable();
      // Conditional branch for this case.
      if (originalWindow === undefined) {
        // @ts-expect-error restore Node without a window global
        delete globalThis.window;
      // Open multi-line construct.
      } else {
        // Invoke helper or pass arguments.
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
      // Conditional branch for this case.
      if (originalDocument === undefined) {
        // @ts-expect-error restore Node without a document global
        delete globalThis.document;
      // Open multi-line construct.
      } else {
        // Invoke helper or pass arguments.
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      }
      // Conditional branch for this case.
      if (originalNavigator === undefined) {
        // @ts-expect-error restore Node without a navigator global
        delete globalThis.navigator;
      // Open multi-line construct.
      } else {
        // Invoke helper or pass arguments.
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
      }
    }
  });
});
