/**
 * Unit: delayed visibility controller (anti-flicker for loading chrome).
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import { createDelayedVisible } from "./delayedVisible";

// Local type alias shaping data.
type FakeTimer = { id: number; due: number; callback: () => void };

// Function definition.
function createFakeClock() {
  // Mutable local binding.
  let now = 0;
  // Mutable local binding.
  let nextId = 1;
  // Local constant binding.
  const timers = new Map<number, FakeTimer>();
  // Return computed result to caller.
  return {
    // Arrow function / callback body.
    now: () => now,
    // Invoke helper or pass arguments.
    advance(ms: number) {
      // Assign value for subsequent use.
      now += ms;
      // Local constant binding.
      const due = [...timers.values()]
        // Arrow function / callback body.
        .filter((t) => t.due <= now)
        // Arrow function / callback body.
        .sort((a, b) => a.due - b.due);
      // Iterate collection / range.
      for (const t of due) {
        // Conditional branch for this case.
        if (!timers.has(t.id)) continue;
        // Invoke helper or pass arguments.
        timers.delete(t.id);
        // Invoke helper or pass arguments.
        t.callback();
      }
    },
    // Field/property in this shape.
    clock: {
      // Arrow function / callback body.
      setTimeout(callback: () => void, ms: number) {
        // Local constant binding.
        const id = nextId++;
        // Invoke helper or pass arguments.
        timers.set(id, { id, due: now + ms, callback });
        // Return computed result to caller.
        return id;
      },
      // Invoke helper or pass arguments.
      clearTimeout(id: unknown) {
        // Invoke helper or pass arguments.
        timers.delete(id as number);
      },
    },
    // Arrow function / callback body.
    pending: () => timers.size,
  };
}

// Group related unit tests.
describe("createDelayedVisible", () => {
  // Unit test case.
  it("does not show before delay elapses", () => {
    // Local constant binding.
    const fake = createFakeClock();
    // Local constant binding.
    const seen: boolean[] = [];
    // Local constant binding.
    const ctrl = createDelayedVisible((v) => seen.push(v), 150, fake.clock);
    // Invoke helper or pass arguments.
    ctrl.setActive(true);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), false);
    // Assert expected test outcome.
    assert.deepEqual(seen, []);
    // Invoke helper or pass arguments.
    fake.advance(149);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), false);
    // Invoke helper or pass arguments.
    fake.advance(1);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), true);
    // Assert expected test outcome.
    assert.deepEqual(seen, [true]);
    // Invoke helper or pass arguments.
    ctrl.dispose();
  });

  // Unit test case.
  it("never shows when cleared before delay (no flicker)", () => {
    // Local constant binding.
    const fake = createFakeClock();
    // Local constant binding.
    const seen: boolean[] = [];
    // Local constant binding.
    const ctrl = createDelayedVisible((v) => seen.push(v), 150, fake.clock);
    // Invoke helper or pass arguments.
    ctrl.setActive(true);
    // Invoke helper or pass arguments.
    fake.advance(100);
    // Invoke helper or pass arguments.
    ctrl.setActive(false);
    // Invoke helper or pass arguments.
    fake.advance(200);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), false);
    // Assert expected test outcome.
    assert.deepEqual(seen, []);
    // Assert expected test outcome.
    assert.equal(fake.pending(), 0);
    // Invoke helper or pass arguments.
    ctrl.dispose();
  });

  // Unit test case.
  it("hides immediately on deactivate after visible (error/abort path)", () => {
    // Local constant binding.
    const fake = createFakeClock();
    // Local constant binding.
    const seen: boolean[] = [];
    // Local constant binding.
    const ctrl = createDelayedVisible((v) => seen.push(v), 150, fake.clock);
    // Invoke helper or pass arguments.
    ctrl.setActive(true);
    // Invoke helper or pass arguments.
    fake.advance(150);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), true);
    // Invoke helper or pass arguments.
    ctrl.setActive(false);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), false);
    // Assert expected test outcome.
    assert.deepEqual(seen, [true, false]);
    // Invoke helper or pass arguments.
    ctrl.dispose();
  });

  // Unit test case.
  it("shows immediately when delayMs is 0", () => {
    // Local constant binding.
    const fake = createFakeClock();
    // Local constant binding.
    const seen: boolean[] = [];
    // Local constant binding.
    const ctrl = createDelayedVisible((v) => seen.push(v), 0, fake.clock);
    // Invoke helper or pass arguments.
    ctrl.setActive(true);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), true);
    // Assert expected test outcome.
    assert.deepEqual(seen, [true]);
    // Assert expected test outcome.
    assert.equal(fake.pending(), 0);
    // Invoke helper or pass arguments.
    ctrl.dispose();
  });

  // Unit test case.
  it("dispose clears a pending show timer", () => {
    // Local constant binding.
    const fake = createFakeClock();
    // Local constant binding.
    const ctrl = createDelayedVisible(() => {}, 150, fake.clock);
    // Invoke helper or pass arguments.
    ctrl.setActive(true);
    // Assert expected test outcome.
    assert.equal(fake.pending(), 1);
    // Invoke helper or pass arguments.
    ctrl.dispose();
    // Assert expected test outcome.
    assert.equal(fake.pending(), 0);
    // Invoke helper or pass arguments.
    fake.advance(200);
    // Assert expected test outcome.
    assert.equal(ctrl.isVisible(), false);
  });
});
