// Strict assertions for live SSE delivery filtering.
import assert from "node:assert/strict";
// Node test runner suite helpers.
import { describe, it } from "node:test";
// Role values embedded in DataScope fixtures.
import { Role } from "@prisma/client";
// Used to simulate out-of-scope (403) and missing (404) access checks.
import { AppError } from "../errors";
// Subscriber scope shape passed to canDeliverLiveEvent.
import type { DataScope } from "../services/dataScope";
// Delivery filter under test plus injectable checks type.
import {
  // List item in import/export/params.
  canDeliverLiveEvent,
  // Declare type alias LiveAccessChecks.
  type LiveAccessChecks,
// Support the surrounding logic for this step.
} from "./authorizeLiveEvent";
// Live event payload type from the in-process bus.
import type { LiveEvent } from "./bus";

// Hotel-wide manager scope that sees every location/task/ticket.
const allScope: DataScope = {
  // Provide kind field used by this structure.
  kind: "all",
  // Provide employeeId field used by this structure.
  employeeId: "emp-mgr",
  // Provide role field used by this structure.
  role: Role.manager,
  // Provide sectorIds field used by this structure.
  sectorIds: [],
};

// Housekeeper scope limited to assigned tasks.
const hkScope: DataScope = {
  // Provide kind field used by this structure.
  kind: "assigned_tasks",
  // Provide employeeId field used by this structure.
  employeeId: "emp-hk",
  // Provide role field used by this structure.
  role: Role.housekeeper,
  // Provide sectorIds field used by this structure.
  sectorIds: [],
};

// Build a LiveEvent with a fixed timestamp for deterministic cases.
function at(partial: Partial<LiveEvent> & Pick<LiveEvent, "type">): LiveEvent {
  // Return early result or rendered output from this path.
  return { at: "2026-01-01T00:00:00.000Z", ...partial };
}

// Default stubs deny all entity access; overrides can allow specific asserts.
function checks(overrides: Partial<LiveAccessChecks> = {}): LiveAccessChecks {
  // Bind deny for use in the following logic.
  const deny = async () => {
    // Abort this path by throwing an error to callers.
    throw new AppError(403, "forbidden", "Outside your permitted data scope");
  };
  // Return early result or rendered output from this path.
  return {
    // Provide assertCanAccessLocation field used by this structure.
    assertCanAccessLocation: deny,
    // Provide assertCanAccessTask field used by this structure.
    assertCanAccessTask: deny,
    // Provide assertCanAccessTicket field used by this structure.
    assertCanAccessTicket: deny,
    // Spread prior fields/items so overrides can layer cleanly.
    ...overrides,
  };
}

// Group related tests under a shared suite name.
describe("canDeliverLiveEvent", () => {
  // Global invalidate pings are not location-scoped.
  it("always delivers settings.changed, people.changed, permissions.changed, jobs.changed", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(hkScope, at({ type: "settings.changed" })),
      // List item in import/export/params.
      true,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(hkScope, at({ type: "people.changed" })),
      // List item in import/export/params.
      true,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(hkScope, at({ type: "permissions.changed" })),
      // List item in import/export/params.
      true,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(hkScope, at({ type: "jobs.changed" })),
      // List item in import/export/params.
      true,
    );
  });

  // all-scope still requires identifying ids on ops events.
  it("delivers ops events to all-scope when ids are present", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        allScope,
        // Invoke at to perform this step.
        at({ type: "location.changed", locationId: "loc-1" }),
      ),
      // List item in import/export/params.
      true,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        allScope,
        // Invoke at to perform this step.
        at({ type: "cleaning.changed", taskId: "task-1" }),
      ),
      // List item in import/export/params.
      true,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        allScope,
        // Invoke at to perform this step.
        at({ type: "ticket.changed", ticketId: "tkt-1" }),
      ),
      // List item in import/export/params.
      true,
    );
  });

  // Malformed publishes without ids must never be delivered.
  it("drops ops events that lack identifying ids", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(allScope, at({ type: "location.changed" })),
      // List item in import/export/params.
      false,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(allScope, at({ type: "cleaning.changed" })),
      // List item in import/export/params.
      false,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(allScope, at({ type: "ticket.changed" })),
      // List item in import/export/params.
      false,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(hkScope, at({ type: "cleaning.changed" })),
      // List item in import/export/params.
      false,
    );
  });

  // Default deny stub means housekeeper does not see other tasks.
  it("does not deliver out-of-scope cleaning.changed to housekeeper", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({ type: "cleaning.changed", taskId: "other-task" }),
        // Invoke checks to perform this step.
        checks(),
      ),
      // List item in import/export/params.
      false,
    );
  });

  // Allowing assertCanAccessTask delivers the housekeeper's own task event.
  it("delivers in-scope cleaning.changed to housekeeper", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({ type: "cleaning.changed", taskId: "own-task" }),
        // Invoke checks to perform this step.
        checks({
          // Provide assertCanAccessTask field used by this structure.
          assertCanAccessTask: async () => undefined,
        }),
      ),
      // List item in import/export/params.
      true,
    );
  });

  // Ticket/location events also soft-fail when access checks deny.
  it("does not deliver out-of-scope ticket/location to housekeeper", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({ type: "ticket.changed", ticketId: "other-tkt" }),
        // Invoke checks to perform this step.
        checks(),
      ),
      // List item in import/export/params.
      false,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({ type: "location.changed", locationId: "other-loc" }),
        // Invoke checks to perform this step.
        checks(),
      ),
      // List item in import/export/params.
      false,
    );
  });

  // 404 from access checks is treated like out-of-scope (do not deliver).
  it("treats missing entity as not deliverable (404)", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({ type: "cleaning.changed", taskId: "gone" }),
        // Invoke checks to perform this step.
        checks({
          // Provide assertCanAccessTask field used by this structure.
          assertCanAccessTask: async () => {
            // Abort this path by throwing an error to callers.
            throw new AppError(404, "not_found", "Task not found");
          },
        }),
      ),
      // List item in import/export/params.
      false,
    );
  });

  // Notification pings are recipient-employee scoped only.
  it("delivers notification.changed only to matching recipient", async () => {
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({
          // Declare a type alias.
          type: "notification.changed",
          // Provide recipientEmployeeId field used by this structure.
          recipientEmployeeId: "emp-hk",
        }),
      ),
      // List item in import/export/params.
      true,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({
          // Declare a type alias.
          type: "notification.changed",
          // Provide recipientEmployeeId field used by this structure.
          recipientEmployeeId: "someone-else",
        }),
      ),
      // List item in import/export/params.
      false,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await canDeliverLiveEvent(
        // List item in import/export/params.
        hkScope,
        // Invoke at to perform this step.
        at({ type: "notification.changed" }),
      ),
      // List item in import/export/params.
      false,
    );
  });
});
