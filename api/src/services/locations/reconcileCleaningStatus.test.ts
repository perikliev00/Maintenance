// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { CleaningStatus, TaskStatus } from "@prisma/client";
// Import module ./reconcileCleaningStatus for this service.
import { resolveOrphanCleaningStatus } from "./reconcileCleaningStatus";

// Run next step: describe("resolveOrphanCleaningStatus", () => {
describe("resolveOrphanCleaningStatus", () => {
  // Run next step: it("keeps in_progress when active task has a running session…
  it("keeps in_progress when active task has a running session", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
        // Set status on the structure being built.
        status: TaskStatus.in_progress,
        // Set hasRunningSession on the structure being built.
        hasRunningSession: true,
      }),
      // Run next step: null,
      null,
    );
  });

  // Run next step: it("heals orphan in_progress with no active task to dirty", …
  it("heals orphan in_progress with no active task to dirty", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.in_progress, null…
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, null),
      // Run next step: CleaningStatus.dirty,
      CleaningStatus.dirty,
    );
  });

  // Run next step: it("heals in_progress without running session to dirty", () …
  it("heals in_progress without running session to dirty", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
        // Set status on the structure being built.
        status: TaskStatus.assigned,
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
      }),
      // Run next step: CleaningStatus.dirty,
      CleaningStatus.dirty,
    );
  });

  // Run next step: it("aligns in_progress to pending_inspection when task await…
  it("aligns in_progress to pending_inspection when task awaits inspection", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
        // Set status on the structure being built.
        status: TaskStatus.awaiting_inspection,
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
      }),
      // Run next step: CleaningStatus.pending_inspection,
      CleaningStatus.pending_inspection,
    );
  });

  // Run next step: it("keeps pending_inspection with matching task", () => {
  it("keeps pending_inspection with matching task", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.pending_inspectio…
      resolveOrphanCleaningStatus(CleaningStatus.pending_inspection, {
        // Set status on the structure being built.
        status: TaskStatus.awaiting_inspection,
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
      }),
      // Run next step: null,
      null,
    );
  });

  // Run next step: it("heals orphan pending_inspection to dirty", () => {
  it("heals orphan pending_inspection to dirty", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.pending_inspectio…
      resolveOrphanCleaningStatus(CleaningStatus.pending_inspection, null),
      // Run next step: CleaningStatus.dirty,
      CleaningStatus.dirty,
    );
  });

  // Run next step: it("does not change dirty or verified_clean", () => {
  it("does not change dirty or verified_clean", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.dirty, null),
      resolveOrphanCleaningStatus(CleaningStatus.dirty, null),
      // Run next step: null,
      null,
    );
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveOrphanCleaningStatus(CleaningStatus.verified_clean, n…
      resolveOrphanCleaningStatus(CleaningStatus.verified_clean, null),
      // Run next step: null,
      null,
    );
  });
});
