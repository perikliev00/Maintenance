import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CatalogStatus,
  CleaningStatus,
  LocationKind,
  Occupancy,
  ServiceStatus,
  TaskStatus,
} from "@prisma/client";
import { mapLocation } from "./format";
import type { LocationForMap } from "./types";

function baseLocation(
  overrides: Partial<LocationForMap> = {},
): LocationForMap {
  return {
    id: "loc-1",
    floorId: "floor-1",
    number: "101",
    kind: LocationKind.room,
    catalogStatus: CatalogStatus.active,
    occupancy: Occupancy.vacant,
    cleaningStatus: CleaningStatus.verified_clean,
    serviceStatus: ServiceStatus.in_service,
    floor: {
      number: 1,
      name: "Floor 1",
      building: { name: "Main", code: "M" },
    },
    cleaningTasks: [],
    maintenanceTickets: [],
    ...overrides,
  };
}

describe("mapLocation", () => {
  it("maps empty tasks and tickets", () => {
    const mapped = mapLocation(baseLocation());
    assert.equal(mapped.activeTask, null);
    assert.deepEqual(mapped.blockingIssues, []);
    assert.equal(mapped.readiness, "ready");
    assert.deepEqual(mapped.readinessReasons, []);
    assert.equal(mapped.sector, null);
  });

  it("maps active task with sessions and inspection", () => {
    const startedAt = new Date("2026-10-12T08:00:00.000Z");
    const finishedAt = new Date("2026-10-12T07:00:00.000Z");
    const inspectedAt = new Date("2026-10-12T09:00:00.000Z");

    const mapped = mapLocation(
      baseLocation({
        cleaningTasks: [
          {
            id: "task-1",
            status: TaskStatus.in_progress,
            priority: "normal",
            dueAt: null,
            version: 2,
            reassignReason: null,
            assignedEmployee: {
              id: "emp-1",
              fullName: "Ada",
              employeeNumber: "E1",
            },
            sessions: [
              {
                id: "sess-run",
                status: "running",
                startedAt,
                finishedAt: null,
                notes: null,
                employeeId: "emp-1",
                employee: {
                  id: "emp-1",
                  fullName: "Ada",
                  employeeNumber: "E1",
                },
              },
              {
                id: "sess-done",
                status: "completed",
                startedAt: finishedAt,
                finishedAt,
                notes: "done",
                employeeId: "emp-2",
                employee: {
                  id: "emp-2",
                  fullName: "Bob",
                  employeeNumber: "E2",
                },
              },
            ],
            inspections: [
              {
                id: "insp-1",
                result: "pass",
                findings: null,
                inspectedAt,
                inspector: {
                  id: "emp-3",
                  fullName: "Cara",
                  employeeNumber: "E3",
                },
              },
            ],
          },
        ],
      }),
    );

    assert.ok(mapped.activeTask);
    assert.equal(mapped.activeTask!.id, "task-1");
    assert.deepEqual(mapped.activeTask!.assignee, {
      id: "emp-1",
      fullName: "Ada",
      employeeNumber: "E1",
    });
    assert.deepEqual(mapped.activeTask!.runningSession, {
      id: "sess-run",
      startedAt,
      employeeId: "emp-1",
    });
    assert.deepEqual(mapped.activeTask!.lastCompletedSession, {
      id: "sess-done",
      finishedAt,
      notes: "done",
      employee: {
        id: "emp-2",
        fullName: "Bob",
        employeeNumber: "E2",
      },
    });
    assert.deepEqual(mapped.activeTask!.lastInspection, {
      id: "insp-1",
      result: "pass",
      findings: null,
      inspectedAt,
      inspector: {
        id: "emp-3",
        fullName: "Cara",
        employeeNumber: "E3",
      },
    });
  });

  it("maps blocking tickets into blockingIssues", () => {
    const mapped = mapLocation(
      baseLocation({
        maintenanceTickets: [
          {
            id: "tkt-1",
            title: "Leak",
            categoryKey: "plumbing",
            categoryLabelBg: "ВиК",
            priority: "high",
            status: "open",
            blocksRoom: true,
          },
        ],
      }),
    );

    assert.deepEqual(mapped.blockingIssues, [
      {
        id: "tkt-1",
        title: "Leak",
        category: "plumbing",
        categoryLabelBg: "ВиК",
        priority: "high",
        status: "open",
      },
    ]);
    assert.ok(mapped.readinessReasons.includes("blocking_issue"));
  });

  it("maps active sector and omits inactive sector", () => {
    const withActive = mapLocation(
      baseLocation({
        sectorMembership: {
          sector: {
            id: "sec-1",
            code: "A",
            nameBg: "Сектор А",
            nameEn: "Sector A",
            isActive: true,
          },
        },
      }),
    );
    assert.deepEqual(withActive.sector, {
      id: "sec-1",
      code: "A",
      nameBg: "Сектор А",
      nameEn: "Sector A",
    });

    const withInactive = mapLocation(
      baseLocation({
        sectorMembership: {
          sector: {
            id: "sec-2",
            code: "B",
            nameBg: "Сектор Б",
            nameEn: "Sector B",
            isActive: false,
          },
        },
      }),
    );
    assert.equal(withInactive.sector, null);
  });
});
