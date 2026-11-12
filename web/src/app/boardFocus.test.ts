import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { panelForLocationKind, type BoardFocus } from "./boardFocus";

describe("boardFocus navigation contract", () => {
  it("preserves taskId and sessionId on location focus payloads", () => {
    const focus: BoardFocus = {
      type: "location",
      locationId: "loc-1",
      locationKind: "room",
      taskId: "task-1",
      sessionId: "sess-1",
    };
    assert.equal(focus.taskId, "task-1");
    assert.equal(focus.sessionId, "sess-1");
    assert.equal(panelForLocationKind(focus.locationKind), "rooms");
  });

  it("maps common_area focus to common panel", () => {
    const focus: BoardFocus = {
      type: "location",
      locationId: "loc-2",
      locationKind: "common_area",
      taskId: "task-2",
    };
    assert.equal(panelForLocationKind(focus.locationKind), "common");
  });

  it("ticket focus carries ticketId for repairs", () => {
    const focus: BoardFocus = {
      type: "ticket",
      ticketId: "tkt-1",
      locationId: "loc-9",
    };
    assert.equal(focus.ticketId, "tkt-1");
  });
});
