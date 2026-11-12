// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { OverdueSession } from "../../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  INITIAL_OVERDUE_STATE,
  // Support the surrounding logic for this step.
  applyOverdueFetchResult,
  // Support the surrounding logic for this step.
  overdueFailed,
  // Support the surrounding logic for this step.
  overdueFilterReliable,
  // Support the surrounding logic for this step.
  overdueLoading,
  // Support the surrounding logic for this step.
  overdueReady,
  // Support the surrounding logic for this step.
  showOverdueEmpty,
// Support the surrounding logic for this step.
} from "./overdueState";

// Initialize an object holding related fields.
const sample: OverdueSession = {
  // Provide sessionId field used by this structure.
  sessionId: "s1",
  // Provide taskId field used by this structure.
  taskId: "t1",
  // Provide startedAt field used by this structure.
  startedAt: "2026-01-01T00:00:00.000Z",
  // Provide elapsedMinutes field used by this structure.
  elapsedMinutes: 30,
  // Provide room field used by this structure.
  room: { id: "r1", number: "101", buildingCode: "MAIN", floor: 1 },
  // Provide employee field used by this structure.
  employee: { id: "e1", fullName: "Ada", employeeNumber: "E1" },
};

// Group related tests under a shared suite name.
describe("overdueState", () => {
  // Define a single test case and its expectation.
  it("treats successful empty load as empty, not error", () => {
    // Bind ready for use in the following logic.
    const ready = overdueReady([]);
    // Invoke assert.equal to perform this step.
    assert.equal(ready.status, "ready");
    // Invoke assert.equal to perform this step.
    assert.equal(ready.hasSuccessfulLoad, true);
    // Invoke assert.equal to perform this step.
    assert.equal(showOverdueEmpty(ready), true);
    // Invoke assert.equal to perform this step.
    assert.equal(overdueFilterReliable(ready), true);
  });

  // Define a single test case and its expectation.
  it("surfaces first-load failure without claiming empty success", () => {
    // Bind loading for use in the following logic.
    const loading = overdueLoading(INITIAL_OVERDUE_STATE);
    // Bind failed for use in the following logic.
    const failed = overdueFailed(loading, "network");
    // Invoke assert.equal to perform this step.
    assert.equal(failed.status, "error");
    // Invoke assert.equal to perform this step.
    assert.equal(failed.sessions.length, 0);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.stale, false);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.hasSuccessfulLoad, false);
    // Invoke assert.equal to perform this step.
    assert.equal(showOverdueEmpty(failed), false);
    // Invoke assert.equal to perform this step.
    assert.equal(overdueFilterReliable(failed), false);
  });

  // Define a single test case and its expectation.
  it("keeps nonempty sessions as stale after ready → loading → fail", () => {
    // Bind ready for use in the following logic.
    const ready = overdueReady([sample]);
    // Bind loading for use in the following logic.
    const loading = overdueLoading(ready);
    // Bind failed for use in the following logic.
    const failed = overdueFailed(loading, "timeout");
    // Invoke assert.equal to perform this step.
    assert.equal(failed.status, "error");
    // Invoke assert.equal to perform this step.
    assert.equal(failed.stale, true);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.hasSuccessfulLoad, true);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.sessions.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(showOverdueEmpty(failed), false);
    // Invoke assert.equal to perform this step.
    assert.equal(overdueFilterReliable(failed), false);
  });

  // Define a single test case and its expectation.
  it("keeps empty success as stale after ready → loading → fail", () => {
    // Bind ready for use in the following logic.
    const ready = overdueReady([]);
    // Bind loading for use in the following logic.
    const loading = overdueLoading(ready);
    // Bind failed for use in the following logic.
    const failed = overdueFailed(loading, "timeout");
    // Invoke assert.equal to perform this step.
    assert.equal(failed.stale, true);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.hasSuccessfulLoad, true);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.sessions.length, 0);
    // Invoke assert.equal to perform this step.
    assert.equal(showOverdueEmpty(failed), false);
  });

  // Define a single test case and its expectation.
  it("preserves stale payload across repeated failures", () => {
    // Bind failed1 for use in the following logic.
    const failed1 = overdueFailed(overdueLoading(overdueReady([sample])), "a");
    // Bind failed2 for use in the following logic.
    const failed2 = overdueFailed(overdueLoading(failed1), "b");
    // Invoke assert.equal to perform this step.
    assert.equal(failed2.sessions.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(failed2.stale, true);
    // Invoke assert.equal to perform this step.
    assert.equal(failed2.error, "b");
  });

  // Define a single test case and its expectation.
  it("recovers to ready after retry success", () => {
    // Bind failed for use in the following logic.
    const failed = overdueFailed(overdueLoading(overdueReady([sample])), "boom");
    // Bind recovered for use in the following logic.
    const recovered = overdueReady([]);
    // Invoke assert.equal to perform this step.
    assert.equal(failed.stale, true);
    // Invoke assert.equal to perform this step.
    assert.equal(recovered.status, "ready");
    // Invoke assert.equal to perform this step.
    assert.equal(recovered.stale, false);
    // Invoke assert.equal to perform this step.
    assert.equal(showOverdueEmpty(recovered), true);
  });
});

// Group related tests under a shared suite name.
describe("applyOverdueFetchResult revision gate", () => {
  // Define a single test case and its expectation.
  it("ignores stale success after a newer success", () => {
    // Bind revision for use in the following logic.
    let revision = 0;
    // Bind state for use in the following logic.
    let state = INITIAL_OVERDUE_STATE;
    // Bind r1 for use in the following logic.
    const r1 = ++revision;
    // Bind r2 for use in the following logic.
    const r2 = ++revision;
    // Bind newer for use in the following logic.
    const newer = applyOverdueFetchResult(
      // Support the surrounding logic for this step.
      revision,
      // Support the surrounding logic for this step.
      r2,
      // Support the surrounding logic for this step.
      { ok: true, sessions: [] },
      // Support the surrounding logic for this step.
      state,
    );
    // Invoke assert.ok to perform this step.
    assert.ok(newer);
    // Support the surrounding logic for this step.
    state = newer;
    // Bind older for use in the following logic.
    const older = applyOverdueFetchResult(
      // Support the surrounding logic for this step.
      revision,
      // Support the surrounding logic for this step.
      r1,
      // Support the surrounding logic for this step.
      { ok: true, sessions: [sample] },
      // Support the surrounding logic for this step.
      state,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(older, null);
    // Invoke assert.equal to perform this step.
    assert.equal(state.sessions.length, 0);
  });

  // Define a single test case and its expectation.
  it("ignores stale error after a newer success", () => {
    // Bind revision for use in the following logic.
    let revision = 0;
    // Bind state for use in the following logic.
    let state = INITIAL_OVERDUE_STATE;
    // Bind r1 for use in the following logic.
    const r1 = ++revision;
    // Bind r2 for use in the following logic.
    const r2 = ++revision;
    // Support the surrounding logic for this step.
    state = applyOverdueFetchResult(
      // Support the surrounding logic for this step.
      revision,
      // Support the surrounding logic for this step.
      r2,
      // Support the surrounding logic for this step.
      { ok: true, sessions: [sample] },
      // Support the surrounding logic for this step.
      state,
    // Support the surrounding logic for this step.
    )!;
    // Bind staleErr for use in the following logic.
    const staleErr = applyOverdueFetchResult(
      // Support the surrounding logic for this step.
      revision,
      // Support the surrounding logic for this step.
      r1,
      // Support the surrounding logic for this step.
      { ok: false, message: "old" },
      // Support the surrounding logic for this step.
      state,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(staleErr, null);
    // Invoke assert.equal to perform this step.
    assert.equal(state.status, "ready");
    // Invoke assert.equal to perform this step.
    assert.equal(state.sessions.length, 1);
  });

  // Define a single test case and its expectation.
  it("ignores stale success after a newer error", () => {
    // Bind revision for use in the following logic.
    let revision = 0;
    // Bind state for use in the following logic.
    let state = overdueReady([sample]);
    // Bind r1 for use in the following logic.
    const r1 = ++revision;
    // Bind r2 for use in the following logic.
    const r2 = ++revision;
    // Support the surrounding logic for this step.
    state = applyOverdueFetchResult(
      // Support the surrounding logic for this step.
      revision,
      // Support the surrounding logic for this step.
      r2,
      // Support the surrounding logic for this step.
      { ok: false, message: "new fail" },
      // Invoke overdueLoading to perform this step.
      overdueLoading(state),
    // Support the surrounding logic for this step.
    )!;
    // Invoke assert.equal to perform this step.
    assert.equal(state.status, "error");
    // Invoke assert.equal to perform this step.
    assert.equal(state.stale, true);
    // Bind staleOk for use in the following logic.
    const staleOk = applyOverdueFetchResult(
      // Support the surrounding logic for this step.
      revision,
      // Support the surrounding logic for this step.
      r1,
      // Support the surrounding logic for this step.
      { ok: true, sessions: [] },
      // Support the surrounding logic for this step.
      state,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(staleOk, null);
    // Invoke assert.equal to perform this step.
    assert.equal(state.sessions.length, 1);
  });
});
