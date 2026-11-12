// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  canSaveRosterDraft,
  // Support the surrounding logic for this step.
  shouldApplyRosterLoad,
  // Support the surrounding logic for this step.
  shouldApplyRosterSaveResult,
// Support the surrounding logic for this step.
} from "./shiftRosterLoadLogic";

// Group related tests under a shared suite name.
describe("shiftRosterLoadLogic (MA-03)", () => {
  // Define a single test case and its expectation.
  it("rejects a late day-A GET after the editor moved to day B", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplyRosterLoad to perform this step.
      shouldApplyRosterLoad({
        // Provide requestDate field used by this structure.
        requestDate: "2099-01-01",
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide requestId field used by this structure.
        requestId: 1,
        // Provide latestRequestId field used by this structure.
        latestRequestId: 2,
      }),
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Define a single test case and its expectation.
  it("accepts the latest GET for the active date", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplyRosterLoad to perform this step.
      shouldApplyRosterLoad({
        // Provide requestDate field used by this structure.
        requestDate: "2099-01-02",
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide requestId field used by this structure.
        requestId: 2,
        // Provide latestRequestId field used by this structure.
        latestRequestId: 2,
      }),
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Define a single test case and its expectation.
  it("rejects A→B→A when an older B response finishes late", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplyRosterLoad to perform this step.
      shouldApplyRosterLoad({
        // Provide requestDate field used by this structure.
        requestDate: "2099-01-02",
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-01",
        // Provide requestId field used by this structure.
        requestId: 2,
        // Provide latestRequestId field used by this structure.
        latestRequestId: 3,
      }),
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Define a single test case and its expectation.
  it("blocks save until a draft is loaded for the active date", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canSaveRosterDraft to perform this step.
      canSaveRosterDraft({
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide loadedDate field used by this structure.
        loadedDate: null,
        // Provide busy field used by this structure.
        busy: false,
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canSaveRosterDraft to perform this step.
      canSaveRosterDraft({
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide loadedDate field used by this structure.
        loadedDate: "2099-01-01",
        // Provide busy field used by this structure.
        busy: false,
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canSaveRosterDraft to perform this step.
      canSaveRosterDraft({
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide loadedDate field used by this structure.
        loadedDate: "2099-01-02",
        // Provide busy field used by this structure.
        busy: false,
      }),
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Define a single test case and its expectation.
  it("ignores a late PUT result after the editor changed date", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplyRosterSaveResult to perform this step.
      shouldApplyRosterSaveResult({
        // Provide savedDate field used by this structure.
        savedDate: "2099-01-01",
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide saveRequestId field used by this structure.
        saveRequestId: 1,
        // Provide latestSaveRequestId field used by this structure.
        latestSaveRequestId: 1,
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplyRosterSaveResult to perform this step.
      shouldApplyRosterSaveResult({
        // Provide savedDate field used by this structure.
        savedDate: "2099-01-02",
        // Provide activeDate field used by this structure.
        activeDate: "2099-01-02",
        // Provide saveRequestId field used by this structure.
        saveRequestId: 2,
        // Provide latestSaveRequestId field used by this structure.
        latestSaveRequestId: 2,
      }),
      // Support the surrounding logic for this step.
      true,
    );
  });
});
