// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "./types";
// Import module ./where for this service.
import { locationWhere, scopedLocationIdsFor, sectorWhere, sessionTaskWhere, taskWhere, ticketWhere } from "./where";

// Define allScope — core behavior for this module.
function allScope(): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "all",
    // Set employeeId on the structure being built.
    employeeId: "emp-mgr",
    // Set role on the structure being built.
    role: Role.manager,
    // Set sectorIds on the structure being built.
    sectorIds: [],
  };
}

// Define sectorsScope — core behavior for this module.
function sectorsScope(sectorIds: string[]): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "sectors",
    // Set employeeId on the structure being built.
    employeeId: "emp-sup",
    // Set role on the structure being built.
    role: Role.supervisor,
    // Run next step: sectorIds,
    sectorIds,
  };
}

// Define hkScope — core behavior for this module.
function hkScope(): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "assigned_tasks",
    // Set employeeId on the structure being built.
    employeeId: "emp-hk",
    // Set role on the structure being built.
    role: Role.housekeeper,
    // Set sectorIds on the structure being built.
    sectorIds: [],
  };
}

// Define techScope — core behavior for this module.
function techScope(): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "assigned_tickets",
    // Set employeeId on the structure being built.
    employeeId: "emp-tech",
    // Set role on the structure being built.
    role: Role.technician,
    // Set sectorIds on the structure being built.
    sectorIds: [],
  };
}

// Run next step: describe("taskWhere", () => {
describe("taskWhere", () => {
  // Run next step: it("returns unrestricted filter for all scope", () => {
  it("returns unrestricted filter for all scope", () => {
    // Run next step: assert.deepEqual(taskWhere(allScope()), {});
    assert.deepEqual(taskWhere(allScope()), {});
  });

  // Run next step: it("denies empty sector list", () => {
  it("denies empty sector list", () => {
    // Run next step: assert.deepEqual(taskWhere(sectorsScope([])), { id: "__none_…
    assert.deepEqual(taskWhere(sectorsScope([])), { id: "__none__" });
  });

  // Run next step: it("filters by sectorId or null sector via location membersh…
  it("filters by sectorId or null sector via location membership", () => {
    // Run next step: assert.deepEqual(taskWhere(sectorsScope(["sec-a", "sec-b"]))…
    assert.deepEqual(taskWhere(sectorsScope(["sec-a", "sec-b"])), {
      // Set OR on the structure being built.
      OR: [
        // Run next step: { sectorId: { in: ["sec-a", "sec-b"] } },
        { sectorId: { in: ["sec-a", "sec-b"] } },
        // Run next step: {
        {
          // Set sectorId on the structure being built.
          sectorId: null,
          // Set location on the structure being built.
          location: {
            // Set sectorMembership on the structure being built.
            sectorMembership: { sectorId: { in: ["sec-a", "sec-b"] } },
          },
        },
      ],
    });
  });

  // Run next step: it("limits housekeeper to assigned tasks", () => {
  it("limits housekeeper to assigned tasks", () => {
    // Run next step: assert.deepEqual(taskWhere(hkScope()), {
    assert.deepEqual(taskWhere(hkScope()), {
      // Set assignedEmployeeId on the structure being built.
      assignedEmployeeId: "emp-hk",
    });
  });

  // Run next step: it("denies technician cleaning-task queue", () => {
  it("denies technician cleaning-task queue", () => {
    // Run next step: assert.deepEqual(taskWhere(techScope()), { id: "__none__" })…
    assert.deepEqual(taskWhere(techScope()), { id: "__none__" });
  });
});

// Run next step: describe("locationWhere", () => {
describe("locationWhere", () => {
  // Run next step: it("returns unrestricted filter for all scope", () => {
  it("returns unrestricted filter for all scope", () => {
    // Run next step: assert.deepEqual(locationWhere(allScope()), {});
    assert.deepEqual(locationWhere(allScope()), {});
  });

  // Run next step: it("denies empty sector list", () => {
  it("denies empty sector list", () => {
    // Run next step: assert.deepEqual(locationWhere(sectorsScope([])), { id: "__n…
    assert.deepEqual(locationWhere(sectorsScope([])), { id: "__none__" });
  });

  // Run next step: it("limits supervisor to sector membership", () => {
  it("limits supervisor to sector membership", () => {
    // Run next step: assert.deepEqual(locationWhere(sectorsScope(["sec-a"])), {
    assert.deepEqual(locationWhere(sectorsScope(["sec-a"])), {
      // Set sectorMembership on the structure being built.
      sectorMembership: { sectorId: { in: ["sec-a"] } },
    });
  });

  // Run next step: it("limits housekeeper to locations with assigned cleaning t…
  it("limits housekeeper to locations with assigned cleaning tasks", () => {
    // Run next step: assert.deepEqual(locationWhere(hkScope()), {
    assert.deepEqual(locationWhere(hkScope()), {
      // Set cleaningTasks on the structure being built.
      cleaningTasks: {
        // Set some on the structure being built.
        some: { assignedEmployeeId: "emp-hk" },
      },
    });
  });

  // Run next step: it("limits technician to locations with assigned tickets", (…
  it("limits technician to locations with assigned tickets", () => {
    // Run next step: assert.deepEqual(locationWhere(techScope()), {
    assert.deepEqual(locationWhere(techScope()), {
      // Set maintenanceTickets on the structure being built.
      maintenanceTickets: {
        // Set some on the structure being built.
        some: { assigneeId: "emp-tech" },
      },
    });
  });
});

// Run next step: describe("ticketWhere", () => {
describe("ticketWhere", () => {
  // Run next step: it("returns unrestricted filter for all scope", () => {
  it("returns unrestricted filter for all scope", () => {
    // Run next step: assert.deepEqual(ticketWhere(allScope()), {});
    assert.deepEqual(ticketWhere(allScope()), {});
  });

  // Run next step: it("denies empty sector list", () => {
  it("denies empty sector list", () => {
    // Run next step: assert.deepEqual(ticketWhere(sectorsScope([])), { id: "__non…
    assert.deepEqual(ticketWhere(sectorsScope([])), { id: "__none__" });
  });

  // Run next step: it("limits supervisor to tickets in their sectors", () => {
  it("limits supervisor to tickets in their sectors", () => {
    // Run next step: assert.deepEqual(ticketWhere(sectorsScope(["sec-a", "sec-b"]…
    assert.deepEqual(ticketWhere(sectorsScope(["sec-a", "sec-b"])), {
      // Set location on the structure being built.
      location: {
        // Set sectorMembership on the structure being built.
        sectorMembership: { sectorId: { in: ["sec-a", "sec-b"] } },
      },
    });
  });

  // Run next step: it("allows housekeeper own reports and tickets on rooms they…
  it("allows housekeeper own reports and tickets on rooms they clean", () => {
    // Run next step: assert.deepEqual(ticketWhere(hkScope()), {
    assert.deepEqual(ticketWhere(hkScope()), {
      // Set OR on the structure being built.
      OR: [
        // Run next step: { reportedByEmployeeId: "emp-hk" },
        { reportedByEmployeeId: "emp-hk" },
        // Run next step: {
        {
          // Set location on the structure being built.
          location: {
            // Set cleaningTasks on the structure being built.
            cleaningTasks: {
              // Set some on the structure being built.
              some: { assignedEmployeeId: "emp-hk" },
            },
          },
        },
      ],
    });
  });

  // Run next step: it("limits technician to assigned repairs", () => {
  it("limits technician to assigned repairs", () => {
    // Run next step: assert.deepEqual(ticketWhere(techScope()), {
    assert.deepEqual(ticketWhere(techScope()), {
      // Set assigneeId on the structure being built.
      assigneeId: "emp-tech",
    });
  });
});

// Run next step: describe("sessionTaskWhere", () => {
describe("sessionTaskWhere", () => {
  // Run next step: it("keeps unrestricted sessions unfiltered", () => {
  it("keeps unrestricted sessions unfiltered", () => {
    // Run next step: assert.deepEqual(sessionTaskWhere(allScope()), {});
    assert.deepEqual(sessionTaskWhere(allScope()), {});
  });

  // Run next step: it("nests task scope under session task relation", () => {
  it("nests task scope under session task relation", () => {
    // Run next step: assert.deepEqual(sessionTaskWhere(sectorsScope(["sec-a"])), …
    assert.deepEqual(sessionTaskWhere(sectorsScope(["sec-a"])), {
      // Set task on the structure being built.
      task: {
        // Set OR on the structure being built.
        OR: [
          // Run next step: { sectorId: { in: ["sec-a"] } },
          { sectorId: { in: ["sec-a"] } },
          // Run next step: {
          {
            // Set sectorId on the structure being built.
            sectorId: null,
            // Set location on the structure being built.
            location: { sectorMembership: { sectorId: { in: ["sec-a"] } } },
          },
        ],
      },
    });
    // Run next step: assert.deepEqual(sessionTaskWhere(hkScope()), {
    assert.deepEqual(sessionTaskWhere(hkScope()), {
      // Set task on the structure being built.
      task: { assignedEmployeeId: "emp-hk" },
    });
  });
});

// Run next step: describe("sectorWhere", () => {
describe("sectorWhere", () => {
  // Run next step: it("allows all sectors for unrestricted scope", () => {
  it("allows all sectors for unrestricted scope", () => {
    // Run next step: assert.deepEqual(sectorWhere(allScope()), {});
    assert.deepEqual(sectorWhere(allScope()), {});
  });

  // Run next step: it("filters sectors and denies empty and field-role scopes",…
  it("filters sectors and denies empty and field-role scopes", () => {
    // Run next step: assert.deepEqual(sectorWhere(sectorsScope(["sec-a", "sec-b"]…
    assert.deepEqual(sectorWhere(sectorsScope(["sec-a", "sec-b"])), {
      // Set id on the structure being built.
      id: { in: ["sec-a", "sec-b"] },
    });
    // Run next step: assert.deepEqual(sectorWhere(sectorsScope([])), { id: "__non…
    assert.deepEqual(sectorWhere(sectorsScope([])), { id: "__none__" });
    // Run next step: assert.deepEqual(sectorWhere(hkScope()), { id: "__none__" })…
    assert.deepEqual(sectorWhere(hkScope()), { id: "__none__" });
    // Run next step: assert.deepEqual(sectorWhere(techScope()), { id: "__none__" …
    assert.deepEqual(sectorWhere(techScope()), { id: "__none__" });
  });
});

// Run next step: describe("scopedLocationIdsFor", () => {
describe("scopedLocationIdsFor", () => {
  // Run next step: it("returns null for unrestricted scope without querying loc…
  it("returns null for unrestricted scope without querying locations", async () => {
    // Run next step: assert.equal(await scopedLocationIdsFor(allScope()), null);
    assert.equal(await scopedLocationIdsFor(allScope()), null);
  });

  // Run next step: it("materializes scoped IDs using the same location predicat…
  it("materializes scoped IDs using the same location predicate", async () => {
    // Capture delegate for use in this scope.
    const delegate = prisma.location as unknown as {
      // Set findMany on the structure being built.
      findMany: (args: unknown) => Promise<Array<{ id: string }>>;
    };
    // Capture original find many for use in this scope.
    const originalFindMany = delegate.findMany;
    // Capture received for use in this scope.
    let received: unknown;
    // Run next step: delegate.findMany = async (args: unknown) => {
    delegate.findMany = async (args: unknown) => {
      // Update received as control flow progresses.
      received = args;
      // Return the computed result to the caller.
      return [{ id: "loc-1" }, { id: "loc-2" }];
    };
    // Attempt the fallible work so errors can be handled below.
    try {
      // Run next step: assert.deepEqual(await scopedLocationIdsFor(hkScope()), ["lo…
      assert.deepEqual(await scopedLocationIdsFor(hkScope()), ["loc-1", "loc-2"]);
      // Run next step: assert.deepEqual(received, {
      assert.deepEqual(received, {
        // Set where on the structure being built.
        where: locationWhere(hkScope()),
        // Set select on the structure being built.
        select: { id: true },
      });
    // Run next step: } finally {
    } finally {
      // Run next step: delegate.findMany = originalFindMany;
      delegate.findMany = originalFindMany;
    }
  });
});
