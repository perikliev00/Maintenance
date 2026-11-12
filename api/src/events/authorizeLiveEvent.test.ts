// Strict assertions for live SSE delivery filtering.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Role values embedded in DataScope fixtures.
import { Role } from "@prisma/client";
// Used to simulate out-of-scope (403) and missing (404) access checks.
import { AppError } from "../errors";
// Subscriber scope shape passed to canDeliverLiveEvent.
import type { DataScope } from "../services/dataScope";
// Delivery filter under test plus injectable checks type.
import {
  canDeliverLiveEvent,
  type LiveAccessChecks,
} from "./authorizeLiveEvent";
// Live event payload type from the in-process bus.
import type { LiveEvent } from "./bus";

// Hotel-wide manager scope that sees every location/task/ticket.
const allScope: DataScope = {
  kind: "all",
  employeeId: "emp-mgr",
  role: Role.manager,
  sectorIds: [],
};

// Housekeeper scope limited to assigned tasks.
const hkScope: DataScope = {
  kind: "assigned_tasks",
  employeeId: "emp-hk",
  role: Role.housekeeper,
  sectorIds: [],
};

// Build a LiveEvent with a fixed timestamp for deterministic cases.
function at(partial: Partial<LiveEvent> & Pick<LiveEvent, "type">): LiveEvent {
  return { at: "2026-01-01T00:00:00.000Z", ...partial };
}

// Default stubs deny all entity access; overrides can allow specific asserts.
function checks(overrides: Partial<LiveAccessChecks> = {}): LiveAccessChecks {
  const deny = async () => {
    // Abort this path by throwing an error to callers.
    throw new AppError(403, "forbidden", "Outside your permitted data scope");
  };
  return {
    assertCanAccessLocation: deny,
    assertCanAccessTask: deny,
    assertCanAccessTicket: deny,
    ...overrides,
  };
}

describe("canDeliverLiveEvent", () => {
  // Global invalidate pings are not location-scoped.
  it("always delivers settings.changed, people.changed, permissions.changed, jobs.changed", async () => {
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "settings.changed" })),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "people.changed" })),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "permissions.changed" })),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "jobs.changed" })),
      true,
    );
  });

  // all-scope still requires identifying ids on ops events.
  it("delivers ops events to all-scope when ids are present", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        allScope,
        at({ type: "location.changed", locationId: "loc-1" }),
      ),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(
        allScope,
        at({ type: "cleaning.changed", taskId: "task-1" }),
      ),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(
        allScope,
        at({ type: "ticket.changed", ticketId: "tkt-1" }),
      ),
      true,
    );
  });

  // Malformed publishes without ids must never be delivered.
  it("drops ops events that lack identifying ids", async () => {
    assert.equal(
      await canDeliverLiveEvent(allScope, at({ type: "location.changed" })),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(allScope, at({ type: "cleaning.changed" })),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(allScope, at({ type: "ticket.changed" })),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "cleaning.changed" })),
      false,
    );
  });

  // Default deny stub means housekeeper does not see other tasks.
  it("does not deliver out-of-scope cleaning.changed to housekeeper", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "cleaning.changed", taskId: "other-task" }),
        checks(),
      ),
      false,
    );
  });

  // Allowing assertCanAccessTask delivers the housekeeper's own task event.
  it("delivers in-scope cleaning.changed to housekeeper", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "cleaning.changed", taskId: "own-task" }),
        checks({
          assertCanAccessTask: async () => undefined,
        }),
      ),
      true,
    );
  });

  // Ticket/location events also soft-fail when access checks deny.
  it("does not deliver out-of-scope ticket/location to housekeeper", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "ticket.changed", ticketId: "other-tkt" }),
        checks(),
      ),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "location.changed", locationId: "other-loc" }),
        checks(),
      ),
      false,
    );
  });

  // 404 from access checks is treated like out-of-scope (do not deliver).
  it("treats missing entity as not deliverable (404)", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "cleaning.changed", taskId: "gone" }),
        checks({
          assertCanAccessTask: async () => {
            // Abort this path by throwing an error to callers.
            throw new AppError(404, "not_found", "Task not found");
          },
        }),
      ),
      false,
    );
  });

  // Notification pings are recipient-employee scoped only.
  it("delivers notification.changed only to matching recipient", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({
          type: "notification.changed",
          recipientEmployeeId: "emp-hk",
        }),
      ),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({
          type: "notification.changed",
          recipientEmployeeId: "someone-else",
        }),
      ),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "notification.changed" }),
      ),
      false,
    );
  });
});
