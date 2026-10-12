import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import type { DataScope } from "./types";
import { locationWhere, taskWhere, ticketWhere } from "./where";

function allScope(): DataScope {
  return {
    kind: "all",
    employeeId: "emp-mgr",
    role: Role.manager,
    sectorIds: [],
  };
}

function sectorsScope(sectorIds: string[]): DataScope {
  return {
    kind: "sectors",
    employeeId: "emp-sup",
    role: Role.supervisor,
    sectorIds,
  };
}

function hkScope(): DataScope {
  return {
    kind: "assigned_tasks",
    employeeId: "emp-hk",
    role: Role.housekeeper,
    sectorIds: [],
  };
}

function techScope(): DataScope {
  return {
    kind: "assigned_tickets",
    employeeId: "emp-tech",
    role: Role.technician,
    sectorIds: [],
  };
}

describe("taskWhere", () => {
  it("returns unrestricted filter for all scope", () => {
    assert.deepEqual(taskWhere(allScope()), {});
  });

  it("denies empty sector list", () => {
    assert.deepEqual(taskWhere(sectorsScope([])), { id: "__none__" });
  });

  it("filters by sectorId or null sector via location membership", () => {
    assert.deepEqual(taskWhere(sectorsScope(["sec-a", "sec-b"])), {
      OR: [
        { sectorId: { in: ["sec-a", "sec-b"] } },
        {
          sectorId: null,
          location: {
            sectorMembership: { sectorId: { in: ["sec-a", "sec-b"] } },
          },
        },
      ],
    });
  });

  it("limits housekeeper to assigned tasks", () => {
    assert.deepEqual(taskWhere(hkScope()), {
      assignedEmployeeId: "emp-hk",
    });
  });

  it("denies technician cleaning-task queue", () => {
    assert.deepEqual(taskWhere(techScope()), { id: "__none__" });
  });
});

describe("locationWhere", () => {
  it("returns unrestricted filter for all scope", () => {
    assert.deepEqual(locationWhere(allScope()), {});
  });

  it("denies empty sector list", () => {
    assert.deepEqual(locationWhere(sectorsScope([])), { id: "__none__" });
  });

  it("limits supervisor to sector membership", () => {
    assert.deepEqual(locationWhere(sectorsScope(["sec-a"])), {
      sectorMembership: { sectorId: { in: ["sec-a"] } },
    });
  });

  it("limits housekeeper to locations with assigned cleaning tasks", () => {
    assert.deepEqual(locationWhere(hkScope()), {
      cleaningTasks: {
        some: { assignedEmployeeId: "emp-hk" },
      },
    });
  });

  it("limits technician to locations with assigned tickets", () => {
    assert.deepEqual(locationWhere(techScope()), {
      maintenanceTickets: {
        some: { assigneeId: "emp-tech" },
      },
    });
  });
});

describe("ticketWhere", () => {
  it("returns unrestricted filter for all scope", () => {
    assert.deepEqual(ticketWhere(allScope()), {});
  });

  it("denies empty sector list", () => {
    assert.deepEqual(ticketWhere(sectorsScope([])), { id: "__none__" });
  });

  it("limits supervisor to tickets in their sectors", () => {
    assert.deepEqual(ticketWhere(sectorsScope(["sec-a", "sec-b"])), {
      location: {
        sectorMembership: { sectorId: { in: ["sec-a", "sec-b"] } },
      },
    });
  });

  it("allows housekeeper own reports and tickets on rooms they clean", () => {
    assert.deepEqual(ticketWhere(hkScope()), {
      OR: [
        { reportedByEmployeeId: "emp-hk" },
        {
          location: {
            cleaningTasks: {
              some: { assignedEmployeeId: "emp-hk" },
            },
          },
        },
      ],
    });
  });

  it("limits technician to assigned repairs", () => {
    assert.deepEqual(ticketWhere(techScope()), {
      assigneeId: "emp-tech",
    });
  });
});
