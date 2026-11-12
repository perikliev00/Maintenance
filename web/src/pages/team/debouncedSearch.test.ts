/**
 * Unit: debounced search bridge (immediate invalidate, delayed commit).
 * Fake timers — no real 300ms waits.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDebouncedSearch } from "./debouncedSearch";

type FakeTimer = {
  id: number;
  fn: () => void;
  ms: number;
  due: number;
};

// Define function createFakeTimers and its behavior.
function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers: FakeTimer[] = [];

  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
      const due = timers
        .filter((t) => t.due <= now)
        .sort((a, b) => a.due - b.due || a.id - b.id);
      for (const t of due) {
        const idx = timers.indexOf(t);
        if (idx >= 0) timers.splice(idx, 1);
        t.fn();
      }
    },
    api: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ id, fn, ms, due: now + ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        const n = id as unknown as number;
        const idx = timers.findIndex((t) => t.id === n);
        if (idx >= 0) timers.splice(idx, 1);
      },
    },
  };
}

describe("createDebouncedSearch", () => {
  it("invalidates immediately and commits only after debounce with final value", () => {
    const clocks = createFakeTimers();
    const invalidates: string[] = [];
    const commits: string[] = [];
    const bridge = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => invalidates.push(bridge.getInput()),
      onCommit: (q) => commits.push(q),
    });

    bridge.onInput("A");
    bridge.onInput("An");
    assert.deepEqual(invalidates, ["A", "An"]);
    assert.deepEqual(commits, []);
    assert.equal(bridge.isPending(), true);
    assert.equal(bridge.getCommitted(), "");

    clocks.advance(299);
    assert.deepEqual(commits, []);
    clocks.advance(1);
    assert.deepEqual(commits, ["An"]);
    assert.equal(bridge.getCommitted(), "An");
    assert.equal(bridge.isPending(), false);
  });

  it("flushRefreshQuery returns current input during pending", () => {
    const clocks = createFakeTimers();
    const bridge = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => undefined,
      onCommit: () => undefined,
    });

    bridge.onInput("An");
    assert.equal(bridge.flushRefreshQuery(), "An");
    assert.equal(bridge.getCommitted(), "");
  });

  it("forceCommitFromInput clears pending and commits current text without onCommit", () => {
    const clocks = createFakeTimers();
    const commits: string[] = [];
    const bridge = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => undefined,
      onCommit: (q) => commits.push(q),
    });

    bridge.onInput("An");
    assert.equal(bridge.forceCommitFromInput(), "An");
    assert.equal(bridge.getCommitted(), "An");
    assert.equal(bridge.isPending(), false);
    clocks.advance(300);
    assert.deepEqual(commits, []);
  });

  it("A→An→A settles with onCommit so pending does not stick", () => {
    const clocks = createFakeTimers();
    const commits: string[] = [];
    const bridge = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => undefined,
      onCommit: (q) => commits.push(q),
    });

    bridge.onInput("A");
    clocks.advance(300);
    assert.deepEqual(commits, ["A"]);

    bridge.onInput("An");
    bridge.onInput("A");
    assert.equal(bridge.isPending(), true);
    clocks.advance(300);
    assert.deepEqual(commits, ["A", "A"]);
    assert.equal(bridge.isPending(), false);
    assert.equal(bridge.getCommitted(), "A");
  });

  it("no-op when trimmed equals committed and not pending", () => {
    const clocks = createFakeTimers();
    let invalidateCount = 0;
    let commitCount = 0;
    const bridge = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => {
        invalidateCount += 1;
      },
      onCommit: () => {
        commitCount += 1;
      },
    });

    bridge.onInput("A");
    clocks.advance(300);
    assert.equal(invalidateCount, 1);
    assert.equal(commitCount, 1);

    bridge.onInput("A");
    bridge.onInput(" A ");
    clocks.advance(300);
    assert.equal(invalidateCount, 1);
    assert.equal(commitCount, 1);
  });

  it("directory and existing bridges are independent instances", () => {
    const clocks = createFakeTimers();
    const dirCommits: string[] = [];
    const candCommits: string[] = [];
    const directory = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => undefined,
      onCommit: (q) => dirCommits.push(q),
    });
    const existing = createDebouncedSearch({
      debounceMs: 300,
      timers: clocks.api,
      onInvalidate: () => undefined,
      onCommit: (q) => candCommits.push(q),
    });

    directory.onInput("Dir");
    existing.onInput("Cand");
    clocks.advance(300);
    assert.deepEqual(dirCommits, ["Dir"]);
    assert.deepEqual(candCommits, ["Cand"]);
  });
});
