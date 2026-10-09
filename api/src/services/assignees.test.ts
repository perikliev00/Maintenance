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
      err.message === message,
  );
}

describe("createCleaningTask / createDailyPlanEntry / reassignCleaningTask assignee policy", () => {
  const roles = CLEANING_ASSIGNEE_ROLES;
  const message = CLEANING_ASSIGNEE_MESSAGE;

  it("rejects a blocked housekeeper account", () => {
    assert.equal(
      employeeIsEligibleAssignee(
        emp({ role: Role.housekeeper, isActive: false }),
        roles,
      ),
      false,
    );
    assertRejects(
      emp({ role: Role.housekeeper, isActive: false }),
      roles,
      message,
    );
  });

  it("rejects a missing employee", () => {
    assert.equal(employeeIsEligibleAssignee(null, roles), false);
    assertRejects(null, roles, message);
  });

  it("rejects an employee without a user account", () => {
    assert.equal(employeeIsEligibleAssignee(emp(null), roles), false);
    assertRejects(emp(null), roles, message);
  });

  it("rejects an active account with an inadmissible role", () => {
    assert.equal(
      employeeIsEligibleAssignee(
        emp({ role: Role.technician, isActive: true }),
        roles,
      ),
      false,
    );
    assertRejects(
      emp({ role: Role.technician, isActive: true }),
      roles,
      message,
    );
  });

  it("accepts a valid active housekeeper", () => {
    const employee = emp({ role: Role.housekeeper, isActive: true });
    assert.equal(employeeIsEligibleAssignee(employee, roles), true);
    assert.doesNotThrow(() =>
      assertEmployeeIsEligibleAssignee(employee, roles, message),
    );
  });

  it("rejects after blocking a previously selected housekeeper (stale client)", () => {
    const previouslySelected = emp({
      role: Role.housekeeper,
      isActive: true,
    });
    assert.equal(employeeIsEligibleAssignee(previouslySelected, roles), true);

    const afterBlock = emp({ role: Role.housekeeper, isActive: false });
    assert.equal(employeeIsEligibleAssignee(afterBlock, roles), false);
    assertRejects(afterBlock, roles, message);
  });
});

describe("assignMaintenanceTicket assignee policy", () => {
  const roles = MAINTENANCE_ASSIGNEE_ROLES;
  const message = MAINTENANCE_ASSIGNEE_MESSAGE;

  it("rejects a blocked technician account", () => {
    assertRejects(
      emp({ role: Role.technician, isActive: false }),
      roles,
      message,
    );
  });

  it("rejects a missing employee", () => {
    assertRejects(null, roles, message);
  });

  it("rejects an employee without a user account", () => {
    assertRejects(emp(null), roles, message);
  });

  it("rejects an active housekeeper (inadmissible role)", () => {
    assertRejects(
      emp({ role: Role.housekeeper, isActive: true }),
      roles,
      message,
    );
  });

  it("accepts a valid active technician", () => {
    assert.doesNotThrow(() =>
      assertEmployeeIsEligibleAssignee(
        emp({ role: Role.technician, isActive: true }),
        roles,
        message,
      ),
    );
  });

  it("accepts a valid active supervisor", () => {
    assert.doesNotThrow(() =>
      assertEmployeeIsEligibleAssignee(
        emp({ role: Role.supervisor, isActive: true }),
        roles,
        message,
      ),
    );
  });

  it("accepts a valid active manager", () => {
    assert.doesNotThrow(() =>
      assertEmployeeIsEligibleAssignee(
        emp({ role: Role.manager, isActive: true }),
        roles,
        message,
      ),
    );
  });

  it("rejects after blocking a previously selected technician (stale client)", () => {
    const previouslySelected = emp({
      role: Role.technician,
      isActive: true,
    });
    assert.equal(employeeIsEligibleAssignee(previouslySelected, roles), true);

    const afterBlock = emp({ role: Role.technician, isActive: false });
    assertRejects(afterBlock, roles, message);
  });
});
