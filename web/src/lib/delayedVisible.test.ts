/**
 * Unit: delayed visibility controller (anti-flicker for loading chrome).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDelayedVisible } from "./delayedVisible";

type FakeTimer = { id: number; due: number; callback: () => void };

// Function definition.
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
      const due = [...timers.values()]
        .filter((t) => t.due <= now)
        .sort((a, b) => a.due - b.due);
      // Iterate collection / range.
      for (const t of due) {
        if (!timers.has(t.id)) continue;
        timers.delete(t.id);
        t.callback();
      }
    },
    clock: {
      setTimeout(callback: () => void, ms: number) {
        const id = nextId++;
        timers.set(id, { id, due: now + ms, callback });
        return id;
      },
      clearTimeout(id: unknown) {
        timers.delete(id as number);
      },
    },
    pending: () => timers.size,
  };
}

describe("createDelayedVisible", () => {
  it("does not show before delay elapses", () => {
    const fake = createFakeClock();
    const seen: boolean[] = [];
    const ctrl = createDelayedVisible((v) => seen.push(v), 150, fake.clock);
    ctrl.setActive(true);
    assert.equal(ctrl.isVisible(), false);
    assert.deepEqual(seen, []);
    fake.advance(149);
    assert.equal(ctrl.isVisible(), false);
    fake.advance(1);
    assert.equal(ctrl.isVisible(), true);
    assert.deepEqual(seen, [true]);
    ctrl.dispose();
  });

  it("never shows when cleared before delay (no flicker)", () => {
    const fake = createFakeClock();
    const seen: boolean[] = [];
    const ctrl = createDelayedVisible((v) => seen.push(v), 150, fake.clock);
    ctrl.setActive(true);
    fake.advance(100);
    ctrl.setActive(false);
    fake.advance(200);
    assert.equal(ctrl.isVisible(), false);
    assert.deepEqual(seen, []);
    assert.equal(fake.pending(), 0);
    ctrl.dispose();
  });

  it("hides immediately on deactivate after visible (error/abort path)", () => {
    const fake = createFakeClock();
    const seen: boolean[] = [];
    const ctrl = createDelayedVisible((v) => seen.push(v), 150, fake.clock);
    ctrl.setActive(true);
    fake.advance(150);
    assert.equal(ctrl.isVisible(), true);
    ctrl.setActive(false);
    assert.equal(ctrl.isVisible(), false);
    assert.deepEqual(seen, [true, false]);
    ctrl.dispose();
  });

  it("shows immediately when delayMs is 0", () => {
    const fake = createFakeClock();
    const seen: boolean[] = [];
    const ctrl = createDelayedVisible((v) => seen.push(v), 0, fake.clock);
    ctrl.setActive(true);
    assert.equal(ctrl.isVisible(), true);
    assert.deepEqual(seen, [true]);
    assert.equal(fake.pending(), 0);
    ctrl.dispose();
  });

  it("dispose clears a pending show timer", () => {
    const fake = createFakeClock();
    const ctrl = createDelayedVisible(() => {}, 150, fake.clock);
    ctrl.setActive(true);
    assert.equal(fake.pending(), 1);
    ctrl.dispose();
    assert.equal(fake.pending(), 0);
    fake.advance(200);
    assert.equal(ctrl.isVisible(), false);
  });
});
