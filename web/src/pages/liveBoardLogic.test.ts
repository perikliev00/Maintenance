// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  attentionActionLabel,
  // Support the surrounding logic for this step.
  attentionDestinationPanel,
  // Support the surrounding logic for this step.
  canCompleteFromLiveBoard,
  // Support the surrounding logic for this step.
  needTitle,
  // Support the surrounding logic for this step.
  sessionCategory,
  // Support the surrounding logic for this step.
  sessionFlagsFromElapsed,
  // Support the surrounding logic for this step.
  shouldApplyLiveSnapshot,
// Support the surrounding logic for this step.
} from "./liveBoardLogic";

// Group related tests under a shared suite name.
describe("liveBoardLogic", () => {
  // Define a single test case and its expectation.
  it("complete requires cleaning.complete, not review_overdue alone", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(canCompleteFromLiveBoard(["cleaning.review_overdue"]), false);
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canCompleteFromLiveBoard to perform this step.
      canCompleteFromLiveBoard(["cleaning.complete", "cleaning.review_overdue"]),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(canCompleteFromLiveBoard(["cleaning.complete"]), true);
  });

  // Define a single test case and its expectation.
  it("BG titles avoid English Inspection needed / Past due", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke needTitle to perform this step.
      needTitle(
        // Support the surrounding logic for this step.
        { kind: "awaiting_inspection", titleKey: "inspection_needed", title: "Inspection needed" },
        // Support the surrounding logic for this step.
        "bg",
      ),
      // Support the surrounding logic for this step.
      "Нужна инспекция",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke needTitle to perform this step.
      needTitle(
        // Support the surrounding logic for this step.
        { kind: "past_due", titleKey: "past_due", title: "Past due" },
        // Support the surrounding logic for this step.
        "bg",
      ),
      // Support the surrounding logic for this step.
      "Просрочена",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke needTitle to perform this step.
      needTitle(
        // Support the surrounding logic for this step.
        { kind: "blocking_ticket", titleKey: "custom", title: "Счупен кран" },
        // Support the surrounding logic for this step.
        "bg",
      ),
      // Support the surrounding logic for this step.
      "Счупен кран",
    );
  });

  // Define a single test case and its expectation.
  it("thresholds use >= and anomaly leads category", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(sessionFlagsFromElapsed(240, 240, 480), {
      // Provide overdue field used by this structure.
      overdue: true,
      // Provide anomaly field used by this structure.
      anomaly: false,
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(sessionFlagsFromElapsed(239, 240, 480), {
      // Provide overdue field used by this structure.
      overdue: false,
      // Provide anomaly field used by this structure.
      anomaly: false,
    });
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke sessionCategory to perform this step.
      sessionCategory({ overdue: true, anomaly: true }),
      // Support the surrounding logic for this step.
      "anomaly",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke sessionCategory to perform this step.
      sessionCategory({ overdue: true, anomaly: false }),
      // Support the surrounding logic for this step.
      "overdue",
    );
  });

  // Define a single test case and its expectation.
  it("helper: stale generation must not apply", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(shouldApplyLiveSnapshot(3, 4), false);
    // Invoke assert.equal to perform this step.
    assert.equal(shouldApplyLiveSnapshot(4, 4), true);
  });

  // Define a single test case and its expectation.
  it("remount must not reuse an aborted generation as current", () => {
    // Mirrors cleanup: bump gen, then a fresh refresh owns gen+1.
    let gen = 1;
    // Bind abortedGen for use in the following logic.
    const abortedGen = gen;
    gen += 1; // cleanup invalidates
    // Bind nextGen for use in the following logic.
    const nextGen = gen;
    // Invoke assert.equal to perform this step.
    assert.equal(shouldApplyLiveSnapshot(abortedGen, nextGen), false);
    // Invoke assert.equal to perform this step.
    assert.equal(shouldApplyLiveSnapshot(nextGen, nextGen), true);
  });

  // Define a single test case and its expectation.
  it("navigation destinations use location kind and ticket panel", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke attentionDestinationPanel to perform this step.
      attentionDestinationPanel({
        // Provide kind field used by this structure.
        kind: "blocking_ticket",
        // Provide location field used by this structure.
        location: {
          // Provide id field used by this structure.
          id: "l1",
          // Provide number field used by this structure.
          number: "101",
          // Provide kind field used by this structure.
          kind: "room",
          // Provide buildingCode field used by this structure.
          buildingCode: "A",
          // Provide floor field used by this structure.
          floor: 1,
        },
      }),
      // Support the surrounding logic for this step.
      "repairs",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke attentionDestinationPanel to perform this step.
      attentionDestinationPanel({
        // Provide kind field used by this structure.
        kind: "awaiting_inspection",
        // Provide location field used by this structure.
        location: {
          // Provide id field used by this structure.
          id: "l2",
          // Provide number field used by this structure.
          number: "Lobby",
          // Provide kind field used by this structure.
          kind: "common_area",
          // Provide buildingCode field used by this structure.
          buildingCode: "A",
          // Provide floor field used by this structure.
          floor: 0,
        },
      }),
      // Support the surrounding logic for this step.
      "common",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke attentionActionLabel to perform this step.
      attentionActionLabel("awaiting_inspection", "bg"),
      // Support the surrounding logic for this step.
      "Преглед на инспекцията",
    );
  });
});
