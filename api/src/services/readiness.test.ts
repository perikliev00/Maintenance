import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CatalogStatus,
  CleaningStatus,
  LocationKind,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";
import { computeReadiness, type RoomState } from "./readiness";

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    kind: LocationKind.room,
    catalogStatus: CatalogStatus.active,
    occupancy: Occupancy.vacant,
    cleaningStatus: CleaningStatus.verified_clean,
    serviceStatus: ServiceStatus.in_service,
    hasBlockingTicket: false,
    ...overrides,
  };
}

describe("computeReadiness", () => {
  it("returns not_ready archived and ignores other fields", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          catalogStatus: CatalogStatus.archived,
          occupancy: Occupancy.occupied,
          cleaningStatus: CleaningStatus.dirty,
          serviceStatus: ServiceStatus.out_of_service,
          hasBlockingTicket: true,
        }),
      ),
      { readiness: "not_ready", reasons: ["archived"] },
    );
  });

  it("needs_check when room occupancy is unknown (no hard blockers)", () => {
    assert.deepEqual(
      computeReadiness(room({ occupancy: Occupancy.unknown })),
      { readiness: "needs_check", reasons: ["occupancy_unknown"] },
    );
  });

  it("needs_check when room service is unknown (no hard blockers)", () => {
    assert.deepEqual(
      computeReadiness(room({ serviceStatus: ServiceStatus.unknown })),
      { readiness: "needs_check", reasons: ["service_unknown"] },
    );
  });

  it("needs_check when both occupancy and service are unknown (no hard blockers)", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          occupancy: Occupancy.unknown,
          serviceStatus: ServiceStatus.unknown,
        }),
      ),
      {
        readiness: "needs_check",
        reasons: ["occupancy_unknown", "service_unknown"],
      },
    );
  });

  it("not_ready when occupancy unknown AND out_of_service (hard blocker wins)", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          occupancy: Occupancy.unknown,
          serviceStatus: ServiceStatus.out_of_service,
        }),
      ),
      {
        readiness: "not_ready",
        reasons: ["out_of_service", "occupancy_unknown"],
      },
    );
  });

  it("not_ready when occupancy unknown AND blocking ticket", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          occupancy: Occupancy.unknown,
          hasBlockingTicket: true,
        }),
      ),
      {
        readiness: "not_ready",
        reasons: ["blocking_issue", "occupancy_unknown"],
      },
    );
  });

  it("needs_check for common area with unknown service", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          kind: LocationKind.common_area,
          occupancy: Occupancy.unknown,
          serviceStatus: ServiceStatus.unknown,
        }),
      ),
      { readiness: "needs_check", reasons: ["service_unknown"] },
    );
  });

  it("does not early-exit common area on unknown occupancy alone", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          kind: LocationKind.common_area,
          occupancy: Occupancy.unknown,
        }),
      ),
      { readiness: "ready", reasons: [] },
    );
  });

  it("ready for vacant clean in-service room", () => {
    assert.deepEqual(computeReadiness(room()), {
      readiness: "ready",
      reasons: [],
    });
  });

  it("ready for clean common area regardless of occupancy", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          kind: LocationKind.common_area,
          occupancy: Occupancy.occupied,
        }),
      ),
      { readiness: "ready", reasons: [] },
    );
  });

  it("not_ready for blocking ticket alone", () => {
    assert.deepEqual(
      computeReadiness(room({ hasBlockingTicket: true })),
      { readiness: "not_ready", reasons: ["blocking_issue"] },
    );
  });

  it("not_ready for occupied room alone", () => {
    assert.deepEqual(
      computeReadiness(room({ occupancy: Occupancy.occupied })),
      { readiness: "not_ready", reasons: ["not_vacant"] },
    );
  });

  it("not_ready for each non-verified cleaning status", () => {
    for (const status of [
      CleaningStatus.dirty,
      CleaningStatus.in_progress,
      CleaningStatus.pending_inspection,
    ] as const) {
      assert.deepEqual(
        computeReadiness(room({ cleaningStatus: status })),
        { readiness: "not_ready", reasons: [`cleaning_${status}`] },
      );
    }
  });

  it("not_ready for out_of_service alone", () => {
    assert.deepEqual(
      computeReadiness(room({ serviceStatus: ServiceStatus.out_of_service })),
      { readiness: "not_ready", reasons: ["out_of_service"] },
    );
  });

  it("accumulates multiple room reasons in order", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          occupancy: Occupancy.occupied,
          cleaningStatus: CleaningStatus.dirty,
          serviceStatus: ServiceStatus.out_of_service,
          hasBlockingTicket: true,
        }),
      ),
      {
        readiness: "not_ready",
        reasons: [
          "blocking_issue",
          "not_vacant",
          "cleaning_dirty",
          "out_of_service",
        ],
      },
    );
  });

  it("accumulates common area reasons without not_vacant", () => {
    assert.deepEqual(
      computeReadiness(
        room({
          kind: LocationKind.common_area,
          occupancy: Occupancy.occupied,
          cleaningStatus: CleaningStatus.dirty,
          serviceStatus: ServiceStatus.out_of_service,
          hasBlockingTicket: true,
        }),
      ),
      {
        readiness: "not_ready",
        reasons: ["blocking_issue", "cleaning_dirty", "out_of_service"],
      },
    );
  });
});
