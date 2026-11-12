/**
 * Unit: debounced search bridge (immediate invalidate, delayed commit).
 * Fake timers — no real 300ms waits.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./debouncedSearch.
import { createDebouncedSearch } from "./debouncedSearch";

// Declare type alias FakeTimer.
type FakeTimer = {
  // Provide id field used by this structure.
  id: number;
  // Provide fn field used by this structure.
  fn: () => void;
  // Provide ms field used by this structure.
  ms: number;
  // Provide due field used by this structure.
  due: number;
};

// Define function createFakeTimers and its behavior.
function createFakeTimers() {
  // Bind now for use in the following logic.
  let now = 0;
  // Bind nextId for use in the following logic.
  let nextId = 1;
  // Initialize an array used by subsequent logic.
  const timers: FakeTimer[] = [];

  // Return early result or rendered output from this path.
  return {
    // Provide now field used by this structure.
    now: () => now,
    // Invoke advance to perform this step.
    advance(ms: number) {
      // Support the surrounding logic for this step.
      now += ms;
      // Bind due for use in the following logic.
      const due = timers
        // Continue a chained call building on the previous expression.
        .filter((t) => t.due <= now)
        // Continue a chained call building on the previous expression.
        .sort((a, b) => a.due - b.due || a.id - b.id);
      // Iterate a collection or counted range.
      for (const t of due) {
        // Bind idx for use in the following logic.
        const idx = timers.indexOf(t);
        // Conditional branch for the case described by this guard.
        if (idx >= 0) timers.splice(idx, 1);
        // Invoke t.fn to perform this step.
        t.fn();
      }
    },
    // Provide api field used by this structure.
    api: {
      // Provide setTimeout field used by this structure.
      setTimeout: (fn: () => void, ms: number) => {
        // Bind id for use in the following logic.
        const id = nextId++;
        // Invoke timers.push to perform this step.
        timers.push({ id, fn, ms, due: now + ms });
        // Return early result or rendered output from this path.
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      // Provide clearTimeout field used by this structure.
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        // Bind n for use in the following logic.
        const n = id as unknown as number;
        // Bind idx for use in the following logic.
        const idx = timers.findIndex((t) => t.id === n);
        // Conditional branch for the case described by this guard.
        if (idx >= 0) timers.splice(idx, 1);
      },
    },
  };
}

// Group related tests under a shared suite name.
describe("createDebouncedSearch", () => {
  // Define a single test case and its expectation.
  it("invalidates immediately and commits only after debounce with final value", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Initialize an array used by subsequent logic.
    const invalidates: string[] = [];
    // Initialize an array used by subsequent logic.
    const commits: string[] = [];
    // Bind bridge for use in the following logic.
    const bridge = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => invalidates.push(bridge.getInput()),
      // Provide onCommit field used by this structure.
      onCommit: (q) => commits.push(q),
    });

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("A");
    // Invoke bridge.onInput to perform this step.
    bridge.onInput("An");
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(invalidates, ["A", "An"]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, []);
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.isPending(), true);
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.getCommitted(), "");

    // Invoke clocks.advance to perform this step.
    clocks.advance(299);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, []);
    // Invoke clocks.advance to perform this step.
    clocks.advance(1);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, ["An"]);
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.getCommitted(), "An");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.isPending(), false);
  });

  // Define a single test case and its expectation.
  it("flushRefreshQuery returns current input during pending", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Bind bridge for use in the following logic.
    const bridge = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => undefined,
      // Provide onCommit field used by this structure.
      onCommit: () => undefined,
    });

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("An");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.flushRefreshQuery(), "An");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.getCommitted(), "");
  });

  // Define a single test case and its expectation.
  it("forceCommitFromInput clears pending and commits current text without onCommit", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Initialize an array used by subsequent logic.
    const commits: string[] = [];
    // Bind bridge for use in the following logic.
    const bridge = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => undefined,
      // Provide onCommit field used by this structure.
      onCommit: (q) => commits.push(q),
    });

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("An");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.forceCommitFromInput(), "An");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.getCommitted(), "An");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.isPending(), false);
    // Invoke clocks.advance to perform this step.
    clocks.advance(300);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, []);
  });

  // Define a single test case and its expectation.
  it("A→An→A settles with onCommit so pending does not stick", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Initialize an array used by subsequent logic.
    const commits: string[] = [];
    // Bind bridge for use in the following logic.
    const bridge = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => undefined,
      // Provide onCommit field used by this structure.
      onCommit: (q) => commits.push(q),
    });

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("A");
    // Invoke clocks.advance to perform this step.
    clocks.advance(300);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, ["A"]);

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("An");
    // Invoke bridge.onInput to perform this step.
    bridge.onInput("A");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.isPending(), true);
    // Invoke clocks.advance to perform this step.
    clocks.advance(300);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, ["A", "A"]);
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.isPending(), false);
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.getCommitted(), "A");
  });

  // Define a single test case and its expectation.
  it("no-op when trimmed equals committed and not pending", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Bind invalidateCount for use in the following logic.
    let invalidateCount = 0;
    // Bind commitCount for use in the following logic.
    let commitCount = 0;
    // Bind bridge for use in the following logic.
    const bridge = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => {
        // Support the surrounding logic for this step.
        invalidateCount += 1;
      },
      // Provide onCommit field used by this structure.
      onCommit: () => {
        // Support the surrounding logic for this step.
        commitCount += 1;
      },
    });

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("A");
    // Invoke clocks.advance to perform this step.
    clocks.advance(300);
    // Invoke assert.equal to perform this step.
    assert.equal(invalidateCount, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(commitCount, 1);

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("A");
    // Invoke bridge.onInput to perform this step.
    bridge.onInput(" A ");
    // Invoke clocks.advance to perform this step.
    clocks.advance(300);
    // Invoke assert.equal to perform this step.
    assert.equal(invalidateCount, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(commitCount, 1);
  });

  // Define a single test case and its expectation.
  it("directory and existing bridges are independent instances", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Initialize an array used by subsequent logic.
    const dirCommits: string[] = [];
    // Initialize an array used by subsequent logic.
    const candCommits: string[] = [];
    // Bind directory for use in the following logic.
    const directory = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => undefined,
      // Provide onCommit field used by this structure.
      onCommit: (q) => dirCommits.push(q),
    });
    // Bind existing for use in the following logic.
    const existing = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 300,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => undefined,
      // Provide onCommit field used by this structure.
      onCommit: (q) => candCommits.push(q),
    });

    // Invoke directory.onInput to perform this step.
    directory.onInput("Dir");
    // Invoke existing.onInput to perform this step.
    existing.onInput("Cand");
    // Invoke clocks.advance to perform this step.
    clocks.advance(300);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(dirCommits, ["Dir"]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(candCommits, ["Cand"]);
  });
});
