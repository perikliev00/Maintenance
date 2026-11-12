// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./slaPause for this service.
import { unpauseFields } from "./slaPause";

// Run next step: describe("unpauseFields", () => {
describe("unpauseFields", () => {
  // Run next step: it("returns identity when not paused", () => {
  it("returns identity when not paused", () => {
    // Capture due at for use in this scope.
    const dueAt = new Date("2026-10-12T10:00:00.000Z");
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: unpauseFields({
      unpauseFields({
        // Run next step: dueAt,
        dueAt,
        // Set slaPausedAt on the structure being built.
        slaPausedAt: null,
        // Set slaPausedMsTotal on the structure being built.
        slaPausedMsTotal: 5_000,
      }),
      // Run next step: {
      {
        // Set slaPausedAt on the structure being built.
        slaPausedAt: null,
        // Set slaPausedMsTotal on the structure being built.
        slaPausedMsTotal: 5_000,
        // Run next step: dueAt,
        dueAt,
      },
    );
  });

  // Run next step: it("shifts SLA deadline by pause duration", () => {
  it("shifts SLA deadline by pause duration", () => {
    // Capture sla paused at for use in this scope.
    const slaPausedAt = new Date("2026-10-12T10:00:00.000Z");
    // Capture now for use in this scope.
    const now = new Date("2026-10-12T10:30:00.000Z");
    // Capture due at for use in this scope.
    const dueAt = new Date("2026-10-12T12:00:00.000Z");
    // Capture paused ms for use in this scope.
    const pausedMs = 30 * 60 * 1000;

    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: unpauseFields(
      unpauseFields(
        // Run next step: { dueAt, slaPausedAt, slaPausedMsTotal: 1_000 },
        { dueAt, slaPausedAt, slaPausedMsTotal: 1_000 },
        // Run next step: now,
        now,
      ),
      // Run next step: {
      {
        // Set slaPausedAt on the structure being built.
        slaPausedAt: null,
        // Set slaPausedMsTotal on the structure being built.
        slaPausedMsTotal: 1_000 + pausedMs,
        // Set dueAt on the structure being built.
        dueAt: new Date(dueAt.getTime() + pausedMs),
      },
    );
  });

  // Run next step: it("accumulates pause ms when dueAt is null", () => {
  it("accumulates pause ms when dueAt is null", () => {
    // Capture sla paused at for use in this scope.
    const slaPausedAt = new Date("2026-10-12T10:00:00.000Z");
    // Capture now for use in this scope.
    const now = new Date("2026-10-12T10:15:00.000Z");
    // Capture paused ms for use in this scope.
    const pausedMs = 15 * 60 * 1000;

    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: unpauseFields(
      unpauseFields(
        // Run next step: { dueAt: null, slaPausedAt, slaPausedMsTotal: 2_000 },
        { dueAt: null, slaPausedAt, slaPausedMsTotal: 2_000 },
        // Run next step: now,
        now,
      ),
      // Run next step: {
      {
        // Set slaPausedAt on the structure being built.
        slaPausedAt: null,
        // Set slaPausedMsTotal on the structure being built.
        slaPausedMsTotal: 2_000 + pausedMs,
        // Set dueAt on the structure being built.
        dueAt: null,
      },
    );
  });

  // Run next step: it("clamps negative pause duration to zero", () => {
  it("clamps negative pause duration to zero", () => {
    // Capture sla paused at for use in this scope.
    const slaPausedAt = new Date("2026-10-12T11:00:00.000Z");
    // Capture now for use in this scope.
    const now = new Date("2026-10-12T10:00:00.000Z");
    // Capture due at for use in this scope.
    const dueAt = new Date("2026-10-12T12:00:00.000Z");

    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: unpauseFields(
      unpauseFields(
        // Run next step: { dueAt, slaPausedAt, slaPausedMsTotal: 500 },
        { dueAt, slaPausedAt, slaPausedMsTotal: 500 },
        // Run next step: now,
        now,
      ),
      // Run next step: {
      {
        // Set slaPausedAt on the structure being built.
        slaPausedAt: null,
        // Set slaPausedMsTotal on the structure being built.
        slaPausedMsTotal: 500,
        // Run next step: dueAt,
        dueAt,
      },
    );
  });
});
