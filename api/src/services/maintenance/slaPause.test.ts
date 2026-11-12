import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unpauseFields } from "./slaPause";

describe("unpauseFields", () => {
  it("returns identity when not paused", () => {
    // Capture due at for use in this scope.
    const dueAt = new Date("2026-10-12T10:00:00.000Z");
    assert.deepEqual(
      unpauseFields({
        dueAt,
        slaPausedAt: null,
        slaPausedMsTotal: 5_000,
      }),
      {
        slaPausedAt: null,
        slaPausedMsTotal: 5_000,
        dueAt,
      },
    );
  });

  it("shifts SLA deadline by pause duration", () => {
    // Capture sla paused at for use in this scope.
    const slaPausedAt = new Date("2026-10-12T10:00:00.000Z");
    const now = new Date("2026-10-12T10:30:00.000Z");
    // Capture due at for use in this scope.
    const dueAt = new Date("2026-10-12T12:00:00.000Z");
    // Capture paused ms for use in this scope.
    const pausedMs = 30 * 60 * 1000;

    assert.deepEqual(
      unpauseFields(
        { dueAt, slaPausedAt, slaPausedMsTotal: 1_000 },
        now,
      ),
      {
        slaPausedAt: null,
        slaPausedMsTotal: 1_000 + pausedMs,
        dueAt: new Date(dueAt.getTime() + pausedMs),
      },
    );
  });

  it("accumulates pause ms when dueAt is null", () => {
    // Capture sla paused at for use in this scope.
    const slaPausedAt = new Date("2026-10-12T10:00:00.000Z");
    const now = new Date("2026-10-12T10:15:00.000Z");
    // Capture paused ms for use in this scope.
    const pausedMs = 15 * 60 * 1000;

    assert.deepEqual(
      unpauseFields(
        { dueAt: null, slaPausedAt, slaPausedMsTotal: 2_000 },
        now,
      ),
      {
        slaPausedAt: null,
        slaPausedMsTotal: 2_000 + pausedMs,
        dueAt: null,
      },
    );
  });

  it("clamps negative pause duration to zero", () => {
    // Capture sla paused at for use in this scope.
    const slaPausedAt = new Date("2026-10-12T11:00:00.000Z");
    const now = new Date("2026-10-12T10:00:00.000Z");
    // Capture due at for use in this scope.
    const dueAt = new Date("2026-10-12T12:00:00.000Z");

    assert.deepEqual(
      unpauseFields(
        { dueAt, slaPausedAt, slaPausedMsTotal: 500 },
        now,
      ),
      {
        slaPausedAt: null,
        slaPausedMsTotal: 500,
        dueAt,
      },
    );
  });
});
