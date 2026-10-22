import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import { prisma } from "../../db";
import type { DataScope } from "./types";
import { locationWhere, scopedLocationIdsFor, sectorWhere, sessionTaskWhere, taskWhere, ticketWhere } from "./where";

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

describe("sessionTaskWhere", () => {
  it("keeps unrestricted sessions unfiltered", () => {
    assert.deepEqual(sessionTaskWhere(allScope()), {});
  });

  it("nests task scope under session task relation", () => {
    assert.deepEqual(sessionTaskWhere(sectorsScope(["sec-a"])), {
      task: {
        OR: [
          { sectorId: { in: ["sec-a"] } },
          {
            sectorId: null,
            location: { sectorMembership: { sectorId: { in: ["sec-a"] } } },
          },
        ],
      },
    });
    assert.deepEqual(sessionTaskWhere(hkScope()), {
      task: { assignedEmployeeId: "emp-hk" },
    });
  });
});

describe("sectorWhere", () => {
  it("allows all sectors for unrestricted scope", () => {
    assert.deepEqual(sectorWhere(allScope()), {});
  });

  it("filters sectors and denies empty and field-role scopes", () => {
    assert.deepEqual(sectorWhere(sectorsScope(["sec-a", "sec-b"])), {
      id: { in: ["sec-a", "sec-b"] },
    });
    assert.deepEqual(sectorWhere(sectorsScope([])), { id: "__none__" });
    assert.deepEqual(sectorWhere(hkScope()), { id: "__none__" });
    assert.deepEqual(sectorWhere(techScope()), { id: "__none__" });
  });
});

describe("scopedLocationIdsFor", () => {
  it("returns null for unrestricted scope without querying locations", async () => {
    assert.equal(await scopedLocationIdsFor(allScope()), null);
  });

  it("materializes scoped IDs using the same location predicate", async () => {
    const delegate = prisma.location as unknown as {
      findMany: (args: unknown) => Promise<Array<{ id: string }>>;
    };
    const originalFindMany = delegate.findMany;
    let received: unknown;
    delegate.findMany = async (args: unknown) => {
      received = args;
      return [{ id: "loc-1" }, { id: "loc-2" }];
    };
    try {
      assert.deepEqual(await scopedLocationIdsFor(hkScope()), ["loc-1", "loc-2"]);
      assert.deepEqual(received, {
        where: locationWhere(hkScope()),
        select: { id: true },
      });
    } finally {
      delegate.findMany = originalFindMany;
    }
  });
});
