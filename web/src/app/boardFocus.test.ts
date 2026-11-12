// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./boardFocus.
import { panelForLocationKind, type BoardFocus } from "./boardFocus";

// Group related tests under a shared suite name.
describe("boardFocus navigation contract", () => {
  // Define a single test case and its expectation.
  it("preserves taskId and sessionId on location focus payloads", () => {
    // Initialize an object holding related fields.
    const focus: BoardFocus = {
      // Declare a type alias.
      type: "location",
      // Provide locationId field used by this structure.
      locationId: "loc-1",
      // Provide locationKind field used by this structure.
      locationKind: "room",
      // Provide taskId field used by this structure.
      taskId: "task-1",
      // Provide sessionId field used by this structure.
      sessionId: "sess-1",
    };
    // Invoke assert.equal to perform this step.
    assert.equal(focus.taskId, "task-1");
    // Invoke assert.equal to perform this step.
    assert.equal(focus.sessionId, "sess-1");
    // Invoke assert.equal to perform this step.
    assert.equal(panelForLocationKind(focus.locationKind), "rooms");
  });

  // Define a single test case and its expectation.
  it("maps common_area focus to common panel", () => {
    // Initialize an object holding related fields.
    const focus: BoardFocus = {
      // Declare a type alias.
      type: "location",
      // Provide locationId field used by this structure.
      locationId: "loc-2",
      // Provide locationKind field used by this structure.
      locationKind: "common_area",
      // Provide taskId field used by this structure.
      taskId: "task-2",
    };
    // Invoke assert.equal to perform this step.
    assert.equal(panelForLocationKind(focus.locationKind), "common");
  });

  // Define a single test case and its expectation.
  it("ticket focus carries ticketId for repairs", () => {
    // Initialize an object holding related fields.
    const focus: BoardFocus = {
      // Declare a type alias.
      type: "ticket",
      // Provide ticketId field used by this structure.
      ticketId: "tkt-1",
      // Provide locationId field used by this structure.
      locationId: "loc-9",
    };
    // Invoke assert.equal to perform this step.
    assert.equal(focus.ticketId, "tkt-1");
  });
});
