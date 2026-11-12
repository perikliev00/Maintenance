// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module dependency for this service.
import {
  // Run next step: CatalogStatus,
  CatalogStatus,
  // Run next step: CleaningStatus,
  CleaningStatus,
  // Run next step: LocationKind,
  LocationKind,
  // Run next step: Occupancy,
  Occupancy,
  // Run next step: ServiceStatus,
  ServiceStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ./readiness for this service.
import { computeReadiness, type RoomState } from "./readiness";

// Define room — core behavior for this module.
function room(overrides: Partial<RoomState> = {}): RoomState {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: LocationKind.room,
    // Set catalogStatus on the structure being built.
    catalogStatus: CatalogStatus.active,
    // Set occupancy on the structure being built.
    occupancy: Occupancy.vacant,
    // Set cleaningStatus on the structure being built.
    cleaningStatus: CleaningStatus.verified_clean,
    // Set serviceStatus on the structure being built.
    serviceStatus: ServiceStatus.in_service,
    // Set hasBlockingTicket on the structure being built.
    hasBlockingTicket: false,
    // Run next step: ...overrides,
    ...overrides,
  };
}

// Run next step: describe("computeReadiness", () => {
describe("computeReadiness", () => {
  // Run next step: it("returns not_ready archived and ignores other fields", ()…
  it("returns not_ready archived and ignores other fields", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set catalogStatus on the structure being built.
          catalogStatus: CatalogStatus.archived,
          // Set occupancy on the structure being built.
          occupancy: Occupancy.occupied,
          // Set cleaningStatus on the structure being built.
          cleaningStatus: CleaningStatus.dirty,
          // Set serviceStatus on the structure being built.
          serviceStatus: ServiceStatus.out_of_service,
          // Set hasBlockingTicket on the structure being built.
          hasBlockingTicket: true,
        }),
      ),
      // Run next step: { readiness: "not_ready", reasons: ["archived"] },
      { readiness: "not_ready", reasons: ["archived"] },
    );
  });

  // Run next step: it("needs_check when room occupancy is unknown (no hard bloc…
  it("needs_check when room occupancy is unknown (no hard blockers)", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(room({ occupancy: Occupancy.unknown })),
      computeReadiness(room({ occupancy: Occupancy.unknown })),
      // Run next step: { readiness: "needs_check", reasons: ["occupancy_unknown"] }…
      { readiness: "needs_check", reasons: ["occupancy_unknown"] },
    );
  });

  // Run next step: it("needs_check when room service is unknown (no hard blocke…
  it("needs_check when room service is unknown (no hard blockers)", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(room({ serviceStatus: ServiceStatus.unknown…
      computeReadiness(room({ serviceStatus: ServiceStatus.unknown })),
      // Run next step: { readiness: "needs_check", reasons: ["service_unknown"] },
      { readiness: "needs_check", reasons: ["service_unknown"] },
    );
  });

  // Run next step: it("needs_check when both occupancy and service are unknown …
  it("needs_check when both occupancy and service are unknown (no hard blockers)", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set occupancy on the structure being built.
          occupancy: Occupancy.unknown,
          // Set serviceStatus on the structure being built.
          serviceStatus: ServiceStatus.unknown,
        }),
      ),
      // Run next step: {
      {
        // Set readiness on the structure being built.
        readiness: "needs_check",
        // Set reasons on the structure being built.
        reasons: ["occupancy_unknown", "service_unknown"],
      },
    );
  });

  // Run next step: it("not_ready when occupancy unknown AND out_of_service (har…
  it("not_ready when occupancy unknown AND out_of_service (hard blocker wins)", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set occupancy on the structure being built.
          occupancy: Occupancy.unknown,
          // Set serviceStatus on the structure being built.
          serviceStatus: ServiceStatus.out_of_service,
        }),
      ),
      // Run next step: {
      {
        // Set readiness on the structure being built.
        readiness: "not_ready",
        // Set reasons on the structure being built.
        reasons: ["out_of_service", "occupancy_unknown"],
      },
    );
  });

  // Run next step: it("not_ready when occupancy unknown AND blocking ticket", (…
  it("not_ready when occupancy unknown AND blocking ticket", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set occupancy on the structure being built.
          occupancy: Occupancy.unknown,
          // Set hasBlockingTicket on the structure being built.
          hasBlockingTicket: true,
        }),
      ),
      // Run next step: {
      {
        // Set readiness on the structure being built.
        readiness: "not_ready",
        // Set reasons on the structure being built.
        reasons: ["blocking_issue", "occupancy_unknown"],
      },
    );
  });

  // Run next step: it("needs_check for common area with unknown service", () =>…
  it("needs_check for common area with unknown service", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set kind on the structure being built.
          kind: LocationKind.common_area,
          // Set occupancy on the structure being built.
          occupancy: Occupancy.unknown,
          // Set serviceStatus on the structure being built.
          serviceStatus: ServiceStatus.unknown,
        }),
      ),
      // Run next step: { readiness: "needs_check", reasons: ["service_unknown"] },
      { readiness: "needs_check", reasons: ["service_unknown"] },
    );
  });

  // Run next step: it("does not early-exit common area on unknown occupancy alo…
  it("does not early-exit common area on unknown occupancy alone", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set kind on the structure being built.
          kind: LocationKind.common_area,
          // Set occupancy on the structure being built.
          occupancy: Occupancy.unknown,
        }),
      ),
      // Run next step: { readiness: "ready", reasons: [] },
      { readiness: "ready", reasons: [] },
    );
  });

  // Run next step: it("ready for vacant clean in-service room", () => {
  it("ready for vacant clean in-service room", () => {
    // Run next step: assert.deepEqual(computeReadiness(room()), {
    assert.deepEqual(computeReadiness(room()), {
      // Set readiness on the structure being built.
      readiness: "ready",
      // Set reasons on the structure being built.
      reasons: [],
    });
  });

  // Run next step: it("ready for clean common area regardless of occupancy", ()…
  it("ready for clean common area regardless of occupancy", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set kind on the structure being built.
          kind: LocationKind.common_area,
          // Set occupancy on the structure being built.
          occupancy: Occupancy.occupied,
        }),
      ),
      // Run next step: { readiness: "ready", reasons: [] },
      { readiness: "ready", reasons: [] },
    );
  });

  // Run next step: it("not_ready for blocking ticket alone", () => {
  it("not_ready for blocking ticket alone", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(room({ hasBlockingTicket: true })),
      computeReadiness(room({ hasBlockingTicket: true })),
      // Run next step: { readiness: "not_ready", reasons: ["blocking_issue"] },
      { readiness: "not_ready", reasons: ["blocking_issue"] },
    );
  });

  // Run next step: it("not_ready for occupied room alone", () => {
  it("not_ready for occupied room alone", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(room({ occupancy: Occupancy.occupied })),
      computeReadiness(room({ occupancy: Occupancy.occupied })),
      // Run next step: { readiness: "not_ready", reasons: ["not_vacant"] },
      { readiness: "not_ready", reasons: ["not_vacant"] },
    );
  });

  // Run next step: it("not_ready for each non-verified cleaning status", () => …
  it("not_ready for each non-verified cleaning status", () => {
    // Iterate items to apply the same logic to each entry.
    for (const status of [
      // Run next step: CleaningStatus.dirty,
      CleaningStatus.dirty,
      // Run next step: CleaningStatus.in_progress,
      CleaningStatus.in_progress,
      // Run next step: CleaningStatus.pending_inspection,
      CleaningStatus.pending_inspection,
    // Run next step: ] as const) {
    ] as const) {
      // Run next step: assert.deepEqual(
      assert.deepEqual(
        // Run next step: computeReadiness(room({ cleaningStatus: status })),
        computeReadiness(room({ cleaningStatus: status })),
        // Run next step: { readiness: "not_ready", reasons: [`cleaning_${status}`] },
        { readiness: "not_ready", reasons: [`cleaning_${status}`] },
      );
    }
  });

  // Run next step: it("not_ready for out_of_service alone", () => {
  it("not_ready for out_of_service alone", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(room({ serviceStatus: ServiceStatus.out_of_…
      computeReadiness(room({ serviceStatus: ServiceStatus.out_of_service })),
      // Run next step: { readiness: "not_ready", reasons: ["out_of_service"] },
      { readiness: "not_ready", reasons: ["out_of_service"] },
    );
  });

  // Run next step: it("accumulates multiple room reasons in order", () => {
  it("accumulates multiple room reasons in order", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set occupancy on the structure being built.
          occupancy: Occupancy.occupied,
          // Set cleaningStatus on the structure being built.
          cleaningStatus: CleaningStatus.dirty,
          // Set serviceStatus on the structure being built.
          serviceStatus: ServiceStatus.out_of_service,
          // Set hasBlockingTicket on the structure being built.
          hasBlockingTicket: true,
        }),
      ),
      // Run next step: {
      {
        // Set readiness on the structure being built.
        readiness: "not_ready",
        // Set reasons on the structure being built.
        reasons: [
          // Run next step: "blocking_issue",
          "blocking_issue",
          // Run next step: "not_vacant",
          "not_vacant",
          // Run next step: "cleaning_dirty",
          "cleaning_dirty",
          // Run next step: "out_of_service",
          "out_of_service",
        ],
      },
    );
  });

  // Run next step: it("accumulates common area reasons without not_vacant", () …
  it("accumulates common area reasons without not_vacant", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: computeReadiness(
      computeReadiness(
        // Run next step: room({
        room({
          // Set kind on the structure being built.
          kind: LocationKind.common_area,
          // Set occupancy on the structure being built.
          occupancy: Occupancy.occupied,
          // Set cleaningStatus on the structure being built.
          cleaningStatus: CleaningStatus.dirty,
          // Set serviceStatus on the structure being built.
          serviceStatus: ServiceStatus.out_of_service,
          // Set hasBlockingTicket on the structure being built.
          hasBlockingTicket: true,
        }),
      ),
      // Run next step: {
      {
        // Set readiness on the structure being built.
        readiness: "not_ready",
        // Set reasons on the structure being built.
        reasons: ["blocking_issue", "cleaning_dirty", "out_of_service"],
      },
    );
  });
});
