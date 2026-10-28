import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CleaningStatus, TaskStatus } from "@prisma/client";
import { resolveOrphanCleaningStatus } from "./reconcileCleaningStatus";

describe("resolveOrphanCleaningStatus", () => {
  it("keeps in_progress when active task has a running session", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
        status: TaskStatus.in_progress,
        hasRunningSession: true,
      }),
      null,
    );
  });

  it("heals orphan in_progress with no active task to dirty", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, null),
      CleaningStatus.dirty,
    );
  });

  it("heals in_progress without running session to dirty", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
        status: TaskStatus.assigned,
        hasRunningSession: false,
      }),
      CleaningStatus.dirty,
    );
  });

  it("aligns in_progress to pending_inspection when task awaits inspection", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.in_progress, {
        status: TaskStatus.awaiting_inspection,
        hasRunningSession: false,
      }),
      CleaningStatus.pending_inspection,
    );
  });

  it("keeps pending_inspection with matching task", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.pending_inspection, {
        status: TaskStatus.awaiting_inspection,
        hasRunningSession: false,
      }),
      null,
    );
  });

  it("heals orphan pending_inspection to dirty", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.pending_inspection, null),
      CleaningStatus.dirty,
    );
  });

  it("does not change dirty or verified_clean", () => {
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.dirty, null),
      null,
    );
    assert.equal(
      resolveOrphanCleaningStatus(CleaningStatus.verified_clean, null),
      null,
    );
  });
});
