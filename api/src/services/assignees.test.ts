import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "../errors";
import {
  CLEANING_ASSIGNEE_MESSAGE,
  CLEANING_ASSIGNEE_ROLES,
  MAINTENANCE_ASSIGNEE_MESSAGE,
  MAINTENANCE_ASSIGNEE_ROLES,
  assertEmployeeIsEligibleAssignee,
  employeeIsEligibleAssignee,
  // Type alias AssigneeEmployee.
  type AssigneeEmployee,
} from "./assignees";

function emp(
  user: { role: Role; isActive: boolean } | null,
): NonNullable<AssigneeEmployee> {
  return { user };
}

function assertRejects(
  employee: AssigneeEmployee,
  allowedRoles: readonly Role[],
  message: string,
) {
  assert.throws(
    () => assertEmployeeIsEligibleAssignee(employee, allowedRoles, message),
    (err: unknown) =>
      err instanceof AppError &&
      err.status === 400 &&
      err.code === "validation" &&
      // Assign err.message.
      err.message === message,
  );
}

describe("createCleaningTask / createDailyPlanEntry / reassignCleaningTask assignee policy", () => {
  const roles = CLEANING_ASSIGNEE_ROLES;
  const message = CLEANING_ASSIGNEE_MESSAGE;

  it("rejects an archived housekeeper even when the user is active", () => {
    assert.equal(
      // Invoke employeeIsEligibleAssignee.
      employeeIsEligibleAssignee(
        { archivedAt: new Date(), user: { role: Role.housekeeper, isActive: true } },
        roles,
      ),
      false,
    );
  });

  it("rejects a blocked housekeeper account", () => {
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

  it("rejects a missing employee", () => {
    assert.equal(employeeIsEligibleAssignee(null, roles), false);
    // Invoke assertRejects.
    assertRejects(null, roles, message);
  });

  it("rejects an employee without a user account", () => {
    assert.equal(employeeIsEligibleAssignee(emp(null), roles), false);
    // Invoke assertRejects.
    assertRejects(emp(null), roles, message);
  });

  it("rejects an active account with an inadmissible role", () => {
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

  it("accepts a valid active housekeeper", () => {
    const employee = emp({ role: Role.housekeeper, isActive: true });
    assert.equal(employeeIsEligibleAssignee(employee, roles), true);
    assert.doesNotThrow(() =>
      // Invoke assertEmployeeIsEligibleAssignee.
      assertEmployeeIsEligibleAssignee(employee, roles, message),
    );
  });

  it("rejects after blocking a previously selected housekeeper (stale client)", () => {
    const previouslySelected = emp({
      // Set role.
      role: Role.housekeeper,
      isActive: true,
    });
    assert.equal(employeeIsEligibleAssignee(previouslySelected, roles), true);

    const afterBlock = emp({ role: Role.housekeeper, isActive: false });
    assert.equal(employeeIsEligibleAssignee(afterBlock, roles), false);
    // Invoke assertRejects.
    assertRejects(afterBlock, roles, message);
  });
});

describe("assignMaintenanceTicket assignee policy", () => {
  const roles = MAINTENANCE_ASSIGNEE_ROLES;
  const message = MAINTENANCE_ASSIGNEE_MESSAGE;

  it("rejects a blocked technician account", () => {
    // Invoke assertRejects.
    assertRejects(
      // Invoke emp.
      emp({ role: Role.technician, isActive: false }),
      roles,
      message,
    );
  });

  it("rejects a missing employee", () => {
    // Invoke assertRejects.
    assertRejects(null, roles, message);
  });

  it("rejects an employee without a user account", () => {
    // Invoke assertRejects.
    assertRejects(emp(null), roles, message);
  });

  it("rejects an active housekeeper (inadmissible role)", () => {
    // Invoke assertRejects.
    assertRejects(
      // Invoke emp.
      emp({ role: Role.housekeeper, isActive: true }),
      roles,
      message,
    );
  });

  it("accepts a valid active technician", () => {
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

  it("accepts a valid active supervisor", () => {
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

  it("accepts a valid active manager", () => {
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

  it("rejects after blocking a previously selected technician (stale client)", () => {
    const previouslySelected = emp({
      // Set role.
      role: Role.technician,
      isActive: true,
    });
    assert.equal(employeeIsEligibleAssignee(previouslySelected, roles), true);

    const afterBlock = emp({ role: Role.technician, isActive: false });
    // Invoke assertRejects.
    assertRejects(afterBlock, roles, message);
  });
});
