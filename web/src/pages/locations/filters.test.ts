// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { Room } from "../../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applyRoomFilters,
  // Support the surrounding logic for this step.
  EMPTY_ROOM_FILTERS,
// Support the surrounding logic for this step.
} from "./filters";

// Define function room and its behavior.
function room(overrides: Partial<Room> & Pick<Room, "id" | "number">): Room {
  // Return early result or rendered output from this path.
  return {
    // Provide floor field used by this structure.
    floor: 1,
    // Provide floorName field used by this structure.
    floorName: "1",
    // Provide building field used by this structure.
    building: "MAIN",
    // Provide buildingCode field used by this structure.
    buildingCode: "MAIN",
    // Provide catalogStatus field used by this structure.
    catalogStatus: "active",
    // Provide occupancy field used by this structure.
    occupancy: "vacant",
    // Provide cleaningStatus field used by this structure.
    cleaningStatus: "dirty",
    // Provide serviceStatus field used by this structure.
    serviceStatus: "in_service",
    // Provide readiness field used by this structure.
    readiness: "not_ready",
    // Provide readinessReasons field used by this structure.
    readinessReasons: ["cleaning_dirty"],
    // Provide blockingIssues field used by this structure.
    blockingIssues: [],
    // Provide blockingIssueCount field used by this structure.
    blockingIssueCount: 0,
    // Provide nonBlockingIssueCount field used by this structure.
    nonBlockingIssueCount: 0,
    // Provide activeTask field used by this structure.
    activeTask: null,
    // Spread prior fields/items so overrides can layer cleanly.
    ...overrides,
  };
}

// Group related tests under a shared suite name.
describe("applyRoomFilters", () => {
  // Initialize an array used by subsequent logic.
  const rooms = [
    // Invoke room to perform this step.
    room({
      // Provide id field used by this structure.
      id: "1",
      // Provide number field used by this structure.
      number: "101",
      // Provide buildingCode field used by this structure.
      buildingCode: "MAIN",
      // Provide cleaningStatus field used by this structure.
      cleaningStatus: "dirty",
      // Provide readiness field used by this structure.
      readiness: "not_ready",
      // Provide blockingIssueCount field used by this structure.
      blockingIssueCount: 2,
      // Provide nonBlockingIssueCount field used by this structure.
      nonBlockingIssueCount: 1,
      // Provide activeTask field used by this structure.
      activeTask: {
        // Provide id field used by this structure.
        id: "t1",
        // Provide status field used by this structure.
        status: "rework",
        // Provide priority field used by this structure.
        priority: "normal",
        // Provide dueAt field used by this structure.
        dueAt: null,
        // Provide version field used by this structure.
        version: 1,
        // Provide reassignReason field used by this structure.
        reassignReason: null,
        // Provide assignee field used by this structure.
        assignee: { id: "hk1", fullName: "Maria", employeeNumber: "H001" },
        // Provide runningSession field used by this structure.
        runningSession: null,
        // Provide lastCompletedSession field used by this structure.
        lastCompletedSession: null,
        // Provide lastInspection field used by this structure.
        lastInspection: null,
      },
    }),
    // Invoke room to perform this step.
    room({
      // Provide id field used by this structure.
      id: "2",
      // Provide number field used by this structure.
      number: "205",
      // Provide buildingCode field used by this structure.
      buildingCode: "ANNEX",
      // Provide floor field used by this structure.
      floor: 2,
      // Provide cleaningStatus field used by this structure.
      cleaningStatus: "pending_inspection",
      // Provide readiness field used by this structure.
      readiness: "needs_check",
      // Provide occupancy field used by this structure.
      occupancy: "unknown",
      // Provide activeTask field used by this structure.
      activeTask: {
        // Provide id field used by this structure.
        id: "t2",
        // Provide status field used by this structure.
        status: "awaiting_inspection",
        // Provide priority field used by this structure.
        priority: "high",
        // Provide dueAt field used by this structure.
        dueAt: null,
        // Provide version field used by this structure.
        version: 1,
        // Provide reassignReason field used by this structure.
        reassignReason: null,
        // Provide assignee field used by this structure.
        assignee: { id: "hk2", fullName: "Elena", employeeNumber: "H002" },
        // Provide runningSession field used by this structure.
        runningSession: null,
        // Provide lastCompletedSession field used by this structure.
        lastCompletedSession: null,
        // Provide lastInspection field used by this structure.
        lastInspection: null,
      },
    }),
  ];

  // Define a single test case and its expectation.
  it("filters by room number search", () => {
    // Bind out for use in the following logic.
    const out = applyRoomFilters(
      // Support the surrounding logic for this step.
      rooms,
      // Support the surrounding logic for this step.
      { ...EMPTY_ROOM_FILTERS, q: "205" },
      // Support the surrounding logic for this step.
      new Set(),
    );
    // Invoke assert.equal to perform this step.
    assert.equal(out.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(out[0]!.number, "205");
  });

  // Define a single test case and its expectation.
  it("combines dirty + blocking repairs", () => {
    // Bind out for use in the following logic.
    const out = applyRoomFilters(
      // Support the surrounding logic for this step.
      rooms,
      // Support the surrounding logic for this step.
      { ...EMPTY_ROOM_FILTERS, dirtyOnly: true, blockingRepairs: true },
      // Support the surrounding logic for this step.
      new Set(),
    );
    // Invoke assert.equal to perform this step.
    assert.equal(out.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(out[0]!.number, "101");
  });

  // Define a single test case and its expectation.
  it("filters by assignee", () => {
    // Bind out for use in the following logic.
    const out = applyRoomFilters(
      // Support the surrounding logic for this step.
      rooms,
      // Support the surrounding logic for this step.
      { ...EMPTY_ROOM_FILTERS, assigneeId: "hk2" },
      // Support the surrounding logic for this step.
      new Set(),
    );
    // Invoke assert.equal to perform this step.
    assert.equal(out.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(out[0]!.number, "205");
  });
});
