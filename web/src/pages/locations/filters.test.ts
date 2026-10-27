import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Room } from "../../api/client";
import {
  applyRoomFilters,
  EMPTY_ROOM_FILTERS,
} from "./filters";

function room(overrides: Partial<Room> & Pick<Room, "id" | "number">): Room {
  return {
    floor: 1,
    floorName: "1",
    building: "MAIN",
    buildingCode: "MAIN",
    catalogStatus: "active",
    occupancy: "vacant",
    cleaningStatus: "dirty",
    serviceStatus: "in_service",
    readiness: "not_ready",
    readinessReasons: ["cleaning_dirty"],
    blockingIssues: [],
    blockingIssueCount: 0,
    nonBlockingIssueCount: 0,
    activeTask: null,
    ...overrides,
  };
}

describe("applyRoomFilters", () => {
  const rooms = [
    room({
      id: "1",
      number: "101",
      buildingCode: "MAIN",
      cleaningStatus: "dirty",
      readiness: "not_ready",
      blockingIssueCount: 2,
      nonBlockingIssueCount: 1,
      activeTask: {
        id: "t1",
        status: "rework",
        priority: "normal",
        dueAt: null,
        version: 1,
        reassignReason: null,
        assignee: { id: "hk1", fullName: "Maria", employeeNumber: "H001" },
        runningSession: null,
        lastCompletedSession: null,
        lastInspection: null,
      },
    }),
    room({
      id: "2",
      number: "205",
      buildingCode: "ANNEX",
      floor: 2,
      cleaningStatus: "pending_inspection",
      readiness: "needs_check",
      occupancy: "unknown",
      activeTask: {
        id: "t2",
        status: "awaiting_inspection",
        priority: "high",
        dueAt: null,
        version: 1,
        reassignReason: null,
        assignee: { id: "hk2", fullName: "Elena", employeeNumber: "H002" },
        runningSession: null,
        lastCompletedSession: null,
        lastInspection: null,
      },
    }),
  ];

  it("filters by room number search", () => {
    const out = applyRoomFilters(
      rooms,
      { ...EMPTY_ROOM_FILTERS, q: "205" },
      new Set(),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.number, "205");
  });

  it("combines dirty + blocking repairs", () => {
    const out = applyRoomFilters(
      rooms,
      { ...EMPTY_ROOM_FILTERS, dirtyOnly: true, blockingRepairs: true },
      new Set(),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.number, "101");
  });

  it("filters by assignee", () => {
    const out = applyRoomFilters(
      rooms,
      { ...EMPTY_ROOM_FILTERS, assigneeId: "hk2" },
      new Set(),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.number, "205");
  });
});
