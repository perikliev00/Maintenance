// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Prisma client enums and input types.
import { Role } from "@prisma/client";
// Runtime import from ../errors.
import { AppError } from "../errors";
// Module import required below.
import {
  CLEANING_ASSIGNEE_MESSAGE,
  CLEANING_ASSIGNEE_ROLES,
  MAINTENANCE_ASSIGNEE_MESSAGE,
  MAINTENANCE_ASSIGNEE_ROLES,
  assertEmployeeIsEligibleAssignee,
  employeeIsEligibleAssignee,
  // Type alias AssigneeEmployee.
  type AssigneeEmployee,
// Support the surrounding control flow.
} from "./assignees";

// Internal helper emp.
function emp(
  // Param user required by this function.
  user: { role: Role; isActive: boolean } | null,
): NonNullable<AssigneeEmployee> {
  // Return response object.
  return { user };
}

// Internal helper assertRejects.
function assertRejects(
  // Param employee required by this function.
  employee: AssigneeEmployee,
  // Param allowedRoles required by this function.
  allowedRoles: readonly Role[],
  // Param message required by this function.
  message: string,
) {
  // Expect an error on this path.
  assert.throws(
    // Support the surrounding control flow.
    () => assertEmployeeIsEligibleAssignee(employee, allowedRoles, message),
    // Support the surrounding control flow.
    (err: unknown) =>
      // Additional clause in this boolean decision.
      err instanceof AppError &&
      // Additional clause in this boolean decision.
      err.status === 400 &&
      // Additional clause in this boolean decision.
      err.code === "validation" &&
      // Assign err.message.
      err.message === message,
  );
}

// Test suite: createCleaningTask / createDailyPlanEntry / reassignCleaningTask assignee policy.
describe("createCleaningTask / createDailyPlanEntry / reassignCleaningTask assignee policy", () => {
  // Local roles used below.
  const roles = CLEANING_ASSIGNEE_ROLES;
  // Local message used below.
  const message = CLEANING_ASSIGNEE_MESSAGE;

  // Test case: rejects an archived housekeeper even when the user is active.
  it("rejects an archived housekeeper even when the user is active", () => {
    // Compare scalar values.
    assert.equal(
      // Invoke employeeIsEligibleAssignee.
      employeeIsEligibleAssignee(
        // Support the surrounding control flow.
        { archivedAt: new Date(), user: { role: Role.housekeeper, isActive: true } },
        roles,
      ),
      false,
    );
  });

  // Test case: rejects a blocked housekeeper account.
  it("rejects a blocked housekeeper account", () => {
    // Compare scalar values.
    assert.equal(
      // Invoke employeeIsEligibleAssignee.
      employeeIsEligibleAssignee(
        // Invoke emp.
        emp({ role: Role.housekeeper, isActive: false }),
        roles,
      ),
      false,
    );
    // Invoke assertRejects.
    assertRejects(
      // Invoke emp.
      emp({ role: Role.housekeeper, isActive: false }),
      roles,
      message,
    );
  });

  // Test case: rejects a missing employee.
  it("rejects a missing employee", () => {
    // Compare scalar values.
    assert.equal(employeeIsEligibleAssignee(null, roles), false);
    // Invoke assertRejects.
    assertRejects(null, roles, message);
  });

  // Test case: rejects an employee without a user account.
  it("rejects an employee without a user account", () => {
    // Compare scalar values.
    assert.equal(employeeIsEligibleAssignee(emp(null), roles), false);
    // Invoke assertRejects.
    assertRejects(emp(null), roles, message);
  });

  // Test case: rejects an active account with an inadmissible role.
  it("rejects an active account with an inadmissible role", () => {
    // Compare scalar values.
    assert.equal(
      // Invoke employeeIsEligibleAssignee.
      employeeIsEligibleAssignee(
        // Invoke emp.
        emp({ role: Role.technician, isActive: true }),
        roles,
      ),
      false,
    );
    // Invoke assertRejects.
    assertRejects(
      // Invoke emp.
      emp({ role: Role.technician, isActive: true }),
      roles,
      message,
    );
  });

  // Test case: accepts a valid active housekeeper.
  it("accepts a valid active housekeeper", () => {
    // Local employee used below.
    const employee = emp({ role: Role.housekeeper, isActive: true });
    // Compare scalar values.
    assert.equal(employeeIsEligibleAssignee(employee, roles), true);
    // Assert expected outcome.
    assert.doesNotThrow(() =>
      // Invoke assertEmployeeIsEligibleAssignee.
      assertEmployeeIsEligibleAssignee(employee, roles, message),
    );
  });

  // Test case: rejects after blocking a previously selected housekeeper (stale client).
  it("rejects after blocking a previously selected housekeeper (stale client)", () => {
    // Local previouslySelected used below.
    const previouslySelected = emp({
      // Set role.
      role: Role.housekeeper,
      // Set isActive flag.
      isActive: true,
    });
    // Compare scalar values.
    assert.equal(employeeIsEligibleAssignee(previouslySelected, roles), true);

    // Local afterBlock used below.
    const afterBlock = emp({ role: Role.housekeeper, isActive: false });
    // Compare scalar values.
    assert.equal(employeeIsEligibleAssignee(afterBlock, roles), false);
    // Invoke assertRejects.
    assertRejects(afterBlock, roles, message);
  });
});

// Test suite: assignMaintenanceTicket assignee policy.
describe("assignMaintenanceTicket assignee policy", () => {
  // Local roles used below.
  const roles = MAINTENANCE_ASSIGNEE_ROLES;
  // Local message used below.
  const message = MAINTENANCE_ASSIGNEE_MESSAGE;

  // Test case: rejects a blocked technician account.
  it("rejects a blocked technician account", () => {
    // Invoke assertRejects.
    assertRejects(
      // Invoke emp.
      emp({ role: Role.technician, isActive: false }),
      roles,
      message,
    );
  });

  // Test case: rejects a missing employee.
  it("rejects a missing employee", () => {
    // Invoke assertRejects.
    assertRejects(null, roles, message);
  });

  // Test case: rejects an employee without a user account.
  it("rejects an employee without a user account", () => {
    // Invoke assertRejects.
    assertRejects(emp(null), roles, message);
  });

  // Test case: rejects an active housekeeper (inadmissible role).
  it("rejects an active housekeeper (inadmissible role)", () => {
    // Invoke assertRejects.
    assertRejects(
      // Invoke emp.
      emp({ role: Role.housekeeper, isActive: true }),
      roles,
      message,
    );
  });

  // Test case: accepts a valid active technician.
  it("accepts a valid active technician", () => {
    // Assert expected outcome.
    assert.doesNotThrow(() =>
      // Invoke assertEmployeeIsEligibleAssignee.
      assertEmployeeIsEligibleAssignee(
        // Invoke emp.
        emp({ role: Role.technician, isActive: true }),
        roles,
        message,
      ),
    );
  });

  // Test case: accepts a valid active supervisor.
  it("accepts a valid active supervisor", () => {
    // Assert expected outcome.
    assert.doesNotThrow(() =>
      // Invoke assertEmployeeIsEligibleAssignee.
      assertEmployeeIsEligibleAssignee(
        // Invoke emp.
        emp({ role: Role.supervisor, isActive: true }),
        roles,
        message,
      ),
    );
  });

  // Test case: accepts a valid active manager.
  it("accepts a valid active manager", () => {
    // Assert expected outcome.
    assert.doesNotThrow(() =>
      // Invoke assertEmployeeIsEligibleAssignee.
      assertEmployeeIsEligibleAssignee(
        // Invoke emp.
        emp({ role: Role.manager, isActive: true }),
        roles,
        message,
      ),
    );
  });

  // Test case: rejects after blocking a previously selected technician (stale client).
  it("rejects after blocking a previously selected technician (stale client)", () => {
    // Local previouslySelected used below.
    const previouslySelected = emp({
      // Set role.
      role: Role.technician,
      // Set isActive flag.
      isActive: true,
    });
    // Compare scalar values.
    assert.equal(employeeIsEligibleAssignee(previouslySelected, roles), true);

    // Local afterBlock used below.
    const afterBlock = emp({ role: Role.technician, isActive: false });
    // Invoke assertRejects.
    assertRejects(afterBlock, roles, message);
  });
});
