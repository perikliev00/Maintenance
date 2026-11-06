import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canSaveRosterDraft,
  shouldApplyRosterLoad,
  shouldApplyRosterSaveResult,
} from "./shiftRosterLoadLogic";

describe("shiftRosterLoadLogic (MA-03)", () => {
  it("rejects a late day-A GET after the editor moved to day B", () => {
    assert.equal(
      shouldApplyRosterLoad({
        requestDate: "2099-01-01",
        activeDate: "2099-01-02",
        requestId: 1,
        latestRequestId: 2,
      }),
      false,
    );
  });

  it("accepts the latest GET for the active date", () => {
    assert.equal(
      shouldApplyRosterLoad({
        requestDate: "2099-01-02",
        activeDate: "2099-01-02",
        requestId: 2,
        latestRequestId: 2,
      }),
      true,
    );
  });

  it("rejects A→B→A when an older B response finishes late", () => {
    assert.equal(
      shouldApplyRosterLoad({
        requestDate: "2099-01-02",
        activeDate: "2099-01-01",
        requestId: 2,
        latestRequestId: 3,
      }),
      false,
    );
  });

  it("blocks save until a draft is loaded for the active date", () => {
    assert.equal(
      canSaveRosterDraft({
        activeDate: "2099-01-02",
        loadedDate: null,
        busy: false,
      }),
      false,
    );
    assert.equal(
      canSaveRosterDraft({
        activeDate: "2099-01-02",
        loadedDate: "2099-01-01",
        busy: false,
      }),
      false,
    );
    assert.equal(
      canSaveRosterDraft({
        activeDate: "2099-01-02",
        loadedDate: "2099-01-02",
        busy: false,
      }),
      true,
    );
  });

  it("ignores a late PUT result after the editor changed date", () => {
    assert.equal(
      shouldApplyRosterSaveResult({
        savedDate: "2099-01-01",
        activeDate: "2099-01-02",
        saveRequestId: 1,
        latestSaveRequestId: 1,
      }),
      false,
    );
    assert.equal(
      shouldApplyRosterSaveResult({
        savedDate: "2099-01-02",
        activeDate: "2099-01-02",
        saveRequestId: 2,
        latestSaveRequestId: 2,
      }),
      true,
    );
  });
});
