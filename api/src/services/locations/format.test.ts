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
  // Run next step: TaskStatus,
  TaskStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ./format for this service.
import { mapLocation } from "./format";
// Import type(s) LocationForMap for typing without runtime cost.
import type { LocationForMap } from "./types";

// Define baseLocation — core behavior for this module.
function baseLocation(
  // Set overrides on the structure being built.
  overrides: Partial<LocationForMap> = {},
// Run next step: ): LocationForMap {
): LocationForMap {
  // Return the computed result to the caller.
  return {
    // Set id on the structure being built.
    id: "loc-1",
    // Set floorId on the structure being built.
    floorId: "floor-1",
    // Set number on the structure being built.
    number: "101",
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
    // Set floor on the structure being built.
    floor: {
      // Set number on the structure being built.
      number: 1,
      // Set name on the structure being built.
      name: "Floor 1",
      // Set building on the structure being built.
      building: { name: "Main", code: "M" },
    },
    // Set cleaningTasks on the structure being built.
    cleaningTasks: [],
    // Set maintenanceTickets on the structure being built.
    maintenanceTickets: [],
    // Run next step: ...overrides,
    ...overrides,
  };
}

// Run next step: describe("mapLocation", () => {
describe("mapLocation", () => {
  // Run next step: it("maps empty tasks and tickets", () => {
  it("maps empty tasks and tickets", () => {
    // Capture mapped for use in this scope.
    const mapped = mapLocation(baseLocation());
    // Run next step: assert.equal(mapped.activeTask, null);
    assert.equal(mapped.activeTask, null);
    // Run next step: assert.deepEqual(mapped.blockingIssues, []);
    assert.deepEqual(mapped.blockingIssues, []);
    // Run next step: assert.equal(mapped.readiness, "ready");
    assert.equal(mapped.readiness, "ready");
    // Run next step: assert.deepEqual(mapped.readinessReasons, []);
    assert.deepEqual(mapped.readinessReasons, []);
    // Run next step: assert.equal(mapped.sector, null);
    assert.equal(mapped.sector, null);
  });

  // Run next step: it("maps active task with sessions and inspection", () => {
  it("maps active task with sessions and inspection", () => {
    // Capture started at for use in this scope.
    const startedAt = new Date("2026-10-12T08:00:00.000Z");
    // Capture finished at for use in this scope.
    const finishedAt = new Date("2026-10-12T07:00:00.000Z");
    // Capture inspected at for use in this scope.
    const inspectedAt = new Date("2026-10-12T09:00:00.000Z");

    // Capture mapped for use in this scope.
    const mapped = mapLocation(
      // Run next step: baseLocation({
      baseLocation({
        // Set cleaningTasks on the structure being built.
        cleaningTasks: [
          // Run next step: {
          {
            // Set id on the structure being built.
            id: "task-1",
            // Set status on the structure being built.
            status: TaskStatus.in_progress,
            // Set priority on the structure being built.
            priority: "normal",
            // Set dueAt on the structure being built.
            dueAt: null,
            // Set version on the structure being built.
            version: 2,
            // Set reassignReason on the structure being built.
            reassignReason: null,
            // Set assignedEmployee on the structure being built.
            assignedEmployee: {
              // Set id on the structure being built.
              id: "emp-1",
              // Set fullName on the structure being built.
              fullName: "Ada",
              // Set employeeNumber on the structure being built.
              employeeNumber: "E1",
            },
            // Set sessions on the structure being built.
            sessions: [
              // Run next step: {
              {
                // Set id on the structure being built.
                id: "sess-run",
                // Set status on the structure being built.
                status: "running",
                // Run next step: startedAt,
                startedAt,
                // Set finishedAt on the structure being built.
                finishedAt: null,
                // Set notes on the structure being built.
                notes: null,
                // Set employeeId on the structure being built.
                employeeId: "emp-1",
                // Set employee on the structure being built.
                employee: {
                  // Set id on the structure being built.
                  id: "emp-1",
                  // Set fullName on the structure being built.
                  fullName: "Ada",
                  // Set employeeNumber on the structure being built.
                  employeeNumber: "E1",
                },
              },
              // Run next step: {
              {
                // Set id on the structure being built.
                id: "sess-done",
                // Set status on the structure being built.
                status: "completed",
                // Set startedAt on the structure being built.
                startedAt: finishedAt,
                // Run next step: finishedAt,
                finishedAt,
                // Set notes on the structure being built.
                notes: "done",
                // Set employeeId on the structure being built.
                employeeId: "emp-2",
                // Set employee on the structure being built.
                employee: {
                  // Set id on the structure being built.
                  id: "emp-2",
                  // Set fullName on the structure being built.
                  fullName: "Bob",
                  // Set employeeNumber on the structure being built.
                  employeeNumber: "E2",
                },
              },
            ],
            // Set inspections on the structure being built.
            inspections: [
              // Run next step: {
              {
                // Set id on the structure being built.
                id: "insp-1",
                // Set result on the structure being built.
                result: "pass",
                // Set findings on the structure being built.
                findings: null,
                // Run next step: inspectedAt,
                inspectedAt,
                // Set inspector on the structure being built.
                inspector: {
                  // Set id on the structure being built.
                  id: "emp-3",
                  // Set fullName on the structure being built.
                  fullName: "Cara",
                  // Set employeeNumber on the structure being built.
                  employeeNumber: "E3",
                },
              },
            ],
          },
        ],
      }),
    );

    // Run next step: assert.ok(mapped.activeTask);
    assert.ok(mapped.activeTask);
    // Run next step: assert.equal(mapped.activeTask!.id, "task-1");
    assert.equal(mapped.activeTask!.id, "task-1");
    // Run next step: assert.deepEqual(mapped.activeTask!.assignee, {
    assert.deepEqual(mapped.activeTask!.assignee, {
      // Set id on the structure being built.
      id: "emp-1",
      // Set fullName on the structure being built.
      fullName: "Ada",
      // Set employeeNumber on the structure being built.
      employeeNumber: "E1",
    });
    // Run next step: assert.deepEqual(mapped.activeTask!.runningSession, {
    assert.deepEqual(mapped.activeTask!.runningSession, {
      // Set id on the structure being built.
      id: "sess-run",
      // Run next step: startedAt,
      startedAt,
      // Set employeeId on the structure being built.
      employeeId: "emp-1",
    });
    // Run next step: assert.deepEqual(mapped.activeTask!.lastCompletedSession, {
    assert.deepEqual(mapped.activeTask!.lastCompletedSession, {
      // Set id on the structure being built.
      id: "sess-done",
      // Run next step: finishedAt,
      finishedAt,
      // Set notes on the structure being built.
      notes: "done",
      // Set employee on the structure being built.
      employee: {
        // Set id on the structure being built.
        id: "emp-2",
        // Set fullName on the structure being built.
        fullName: "Bob",
        // Set employeeNumber on the structure being built.
        employeeNumber: "E2",
      },
    });
    // Run next step: assert.deepEqual(mapped.activeTask!.lastInspection, {
    assert.deepEqual(mapped.activeTask!.lastInspection, {
      // Set id on the structure being built.
      id: "insp-1",
      // Set result on the structure being built.
      result: "pass",
      // Set findings on the structure being built.
      findings: null,
      // Run next step: inspectedAt,
      inspectedAt,
      // Set inspector on the structure being built.
      inspector: {
        // Set id on the structure being built.
        id: "emp-3",
        // Set fullName on the structure being built.
        fullName: "Cara",
        // Set employeeNumber on the structure being built.
        employeeNumber: "E3",
      },
    });
  });

  // Run next step: it("maps blocking tickets into blockingIssues", () => {
  it("maps blocking tickets into blockingIssues", () => {
    // Capture mapped for use in this scope.
    const mapped = mapLocation(
      // Run next step: baseLocation({
      baseLocation({
        // Set maintenanceTickets on the structure being built.
        maintenanceTickets: [
          // Run next step: {
          {
            // Set id on the structure being built.
            id: "tkt-1",
            // Set title on the structure being built.
            title: "Leak",
            // Set categoryKey on the structure being built.
            categoryKey: "plumbing",
            // Set categoryLabelBg on the structure being built.
            categoryLabelBg: "ВиК",
            // Set priority on the structure being built.
            priority: "high",
            // Set status on the structure being built.
            status: "open",
            // Set blocksRoom on the structure being built.
            blocksRoom: true,
          },
        ],
      }),
    );

    // Run next step: assert.deepEqual(mapped.blockingIssues, [
    assert.deepEqual(mapped.blockingIssues, [
      // Run next step: {
      {
        // Set id on the structure being built.
        id: "tkt-1",
        // Set title on the structure being built.
        title: "Leak",
        // Set category on the structure being built.
        category: "plumbing",
        // Set categoryLabelBg on the structure being built.
        categoryLabelBg: "ВиК",
        // Set priority on the structure being built.
        priority: "high",
        // Set status on the structure being built.
        status: "open",
      },
    ]);
    // Run next step: assert.ok(mapped.readinessReasons.includes("blocking_issue")…
    assert.ok(mapped.readinessReasons.includes("blocking_issue"));
  });

  // Run next step: it("maps active sector and omits inactive sector", () => {
  it("maps active sector and omits inactive sector", () => {
    // Capture with active for use in this scope.
    const withActive = mapLocation(
      // Run next step: baseLocation({
      baseLocation({
        // Set sectorMembership on the structure being built.
        sectorMembership: {
          // Set sector on the structure being built.
          sector: {
            // Set id on the structure being built.
            id: "sec-1",
            // Set code on the structure being built.
            code: "A",
            // Set nameBg on the structure being built.
            nameBg: "Сектор А",
            // Set nameEn on the structure being built.
            nameEn: "Sector A",
            // Set isActive on the structure being built.
            isActive: true,
          },
        },
      }),
    );
    // Run next step: assert.deepEqual(withActive.sector, {
    assert.deepEqual(withActive.sector, {
      // Set id on the structure being built.
      id: "sec-1",
      // Set code on the structure being built.
      code: "A",
      // Set nameBg on the structure being built.
      nameBg: "Сектор А",
      // Set nameEn on the structure being built.
      nameEn: "Sector A",
    });

    // Capture with inactive for use in this scope.
    const withInactive = mapLocation(
      // Run next step: baseLocation({
      baseLocation({
        // Set sectorMembership on the structure being built.
        sectorMembership: {
          // Set sector on the structure being built.
          sector: {
            // Set id on the structure being built.
            id: "sec-2",
            // Set code on the structure being built.
            code: "B",
            // Set nameBg on the structure being built.
            nameBg: "Сектор Б",
            // Set nameEn on the structure being built.
            nameEn: "Sector B",
            // Set isActive on the structure being built.
            isActive: false,
          },
        },
      }),
    );
    // Run next step: assert.equal(withInactive.sector, null);
    assert.equal(withInactive.sector, null);
  });
});
