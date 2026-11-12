import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OverdueSession } from "../../api/client";
import {
  INITIAL_OVERDUE_STATE,
  applyOverdueFetchResult,
  overdueFailed,
  overdueFilterReliable,
  overdueLoading,
  overdueReady,
  showOverdueEmpty,
} from "./overdueState";

const sample: OverdueSession = {
  sessionId: "s1",
  taskId: "t1",
  startedAt: "2026-01-01T00:00:00.000Z",
  elapsedMinutes: 30,
  room: { id: "r1", number: "101", buildingCode: "MAIN", floor: 1 },
  employee: { id: "e1", fullName: "Ada", employeeNumber: "E1" },
};

describe("overdueState", () => {
  it("treats successful empty load as empty, not error", () => {
    const ready = overdueReady([]);
    assert.equal(ready.status, "ready");
    assert.equal(ready.hasSuccessfulLoad, true);
    assert.equal(showOverdueEmpty(ready), true);
    assert.equal(overdueFilterReliable(ready), true);
  });

  it("surfaces first-load failure without claiming empty success", () => {
    const loading = overdueLoading(INITIAL_OVERDUE_STATE);
    const failed = overdueFailed(loading, "network");
    assert.equal(failed.status, "error");
    assert.equal(failed.sessions.length, 0);
    assert.equal(failed.stale, false);
    assert.equal(failed.hasSuccessfulLoad, false);
    assert.equal(showOverdueEmpty(failed), false);
    assert.equal(overdueFilterReliable(failed), false);
  });

  it("keeps nonempty sessions as stale after ready → loading → fail", () => {
    const ready = overdueReady([sample]);
    const loading = overdueLoading(ready);
    const failed = overdueFailed(loading, "timeout");
    assert.equal(failed.status, "error");
    assert.equal(failed.stale, true);
    assert.equal(failed.hasSuccessfulLoad, true);
    assert.equal(failed.sessions.length, 1);
    assert.equal(showOverdueEmpty(failed), false);
    assert.equal(overdueFilterReliable(failed), false);
  });

  it("keeps empty success as stale after ready → loading → fail", () => {
    const ready = overdueReady([]);
    const loading = overdueLoading(ready);
    const failed = overdueFailed(loading, "timeout");
    assert.equal(failed.stale, true);
    assert.equal(failed.hasSuccessfulLoad, true);
    assert.equal(failed.sessions.length, 0);
    assert.equal(showOverdueEmpty(failed), false);
  });

  it("preserves stale payload across repeated failures", () => {
    const failed1 = overdueFailed(overdueLoading(overdueReady([sample])), "a");
    const failed2 = overdueFailed(overdueLoading(failed1), "b");
    assert.equal(failed2.sessions.length, 1);
    assert.equal(failed2.stale, true);
    assert.equal(failed2.error, "b");
  });

  it("recovers to ready after retry success", () => {
    const failed = overdueFailed(overdueLoading(overdueReady([sample])), "boom");
    const recovered = overdueReady([]);
    assert.equal(failed.stale, true);
    assert.equal(recovered.status, "ready");
    assert.equal(recovered.stale, false);
    assert.equal(showOverdueEmpty(recovered), true);
  });
});

describe("applyOverdueFetchResult revision gate", () => {
  it("ignores stale success after a newer success", () => {
    let revision = 0;
    let state = INITIAL_OVERDUE_STATE;
    const r1 = ++revision;
    const r2 = ++revision;
    const newer = applyOverdueFetchResult(
      revision,
      r2,
      { ok: true, sessions: [] },
      state,
    );
    assert.ok(newer);
    state = newer;
    const older = applyOverdueFetchResult(
      revision,
      r1,
      { ok: true, sessions: [sample] },
      state,
    );
    assert.equal(older, null);
    assert.equal(state.sessions.length, 0);
  });

  it("ignores stale error after a newer success", () => {
    let revision = 0;
    let state = INITIAL_OVERDUE_STATE;
    const r1 = ++revision;
    const r2 = ++revision;
    state = applyOverdueFetchResult(
      revision,
      r2,
      { ok: true, sessions: [sample] },
      state,
    )!;
    const staleErr = applyOverdueFetchResult(
      revision,
      r1,
      { ok: false, message: "old" },
      state,
    );
    assert.equal(staleErr, null);
    assert.equal(state.status, "ready");
    assert.equal(state.sessions.length, 1);
  });

  it("ignores stale success after a newer error", () => {
    let revision = 0;
    let state = overdueReady([sample]);
    const r1 = ++revision;
    const r2 = ++revision;
    state = applyOverdueFetchResult(
      revision,
      r2,
      { ok: false, message: "new fail" },
      overdueLoading(state),
    )!;
    assert.equal(state.status, "error");
    assert.equal(state.stale, true);
    const staleOk = applyOverdueFetchResult(
      revision,
      r1,
      { ok: true, sessions: [] },
      state,
    );
    assert.equal(staleOk, null);
    assert.equal(state.sessions.length, 1);
  });
});
