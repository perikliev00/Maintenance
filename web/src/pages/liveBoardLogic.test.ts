import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attentionActionLabel,
  attentionDestinationPanel,
  canCompleteFromLiveBoard,
  needTitle,
  sessionCategory,
  sessionFlagsFromElapsed,
  shouldApplyLiveSnapshot,
} from "./liveBoardLogic";

describe("liveBoardLogic", () => {
  it("BUG-04: complete requires cleaning.complete, not review_overdue alone", () => {
    assert.equal(canCompleteFromLiveBoard(["cleaning.review_overdue"]), false);
    assert.equal(
      canCompleteFromLiveBoard(["cleaning.complete", "cleaning.review_overdue"]),
      true,
    );
    assert.equal(canCompleteFromLiveBoard(["cleaning.complete"]), true);
  });

  it("BUG-08: BG titles avoid English Inspection needed / Past due", () => {
    assert.equal(
      needTitle(
        { kind: "awaiting_inspection", titleKey: "inspection_needed", title: "Inspection needed" },
        "bg",
      ),
      "Нужна инспекция",
    );
    assert.equal(
      needTitle(
        { kind: "past_due", titleKey: "past_due", title: "Past due" },
        "bg",
      ),
      "Просрочена",
    );
    assert.equal(
      needTitle(
        { kind: "blocking_ticket", titleKey: "custom", title: "Счупен кран" },
        "bg",
      ),
      "Счупен кран",
    );
  });

  it("BUG-07: thresholds use >= and anomaly leads category", () => {
    assert.deepEqual(sessionFlagsFromElapsed(240, 240, 480), {
      overdue: true,
      anomaly: false,
    });
    assert.deepEqual(sessionFlagsFromElapsed(239, 240, 480), {
      overdue: false,
      anomaly: false,
    });
    assert.equal(
      sessionCategory({ overdue: true, anomaly: true }),
      "anomaly",
    );
    assert.equal(
      sessionCategory({ overdue: true, anomaly: false }),
      "overdue",
    );
  });

  it("BUG-05 helper: stale generation must not apply", () => {
    assert.equal(shouldApplyLiveSnapshot(3, 4), false);
    assert.equal(shouldApplyLiveSnapshot(4, 4), true);
  });

  it("remount must not reuse an aborted generation as current", () => {
    // Mirrors cleanup: bump gen, then a fresh refresh owns gen+1.
    let gen = 1;
    const abortedGen = gen;
    gen += 1; // cleanup invalidates
    const nextGen = gen;
    assert.equal(shouldApplyLiveSnapshot(abortedGen, nextGen), false);
    assert.equal(shouldApplyLiveSnapshot(nextGen, nextGen), true);
  });

  it("navigation destinations use location kind and ticket panel", () => {
    assert.equal(
      attentionDestinationPanel({
        kind: "blocking_ticket",
        location: {
          id: "l1",
          number: "101",
          kind: "room",
          buildingCode: "A",
          floor: 1,
        },
      }),
      "repairs",
    );
    assert.equal(
      attentionDestinationPanel({
        kind: "awaiting_inspection",
        location: {
          id: "l2",
          number: "Lobby",
          kind: "common_area",
          buildingCode: "A",
          floor: 0,
        },
      }),
      "common",
    );
    assert.equal(
      attentionActionLabel("awaiting_inspection", "bg"),
      "Преглед на инспекцията",
    );
  });
});
