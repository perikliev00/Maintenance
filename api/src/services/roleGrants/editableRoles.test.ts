// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { Role } from "@prisma/client";
// Import module dependency for this service.
import {
  // Run next step: MATRIX_ROLES,
  MATRIX_ROLES,
  // Run next step: OPERATIONAL_EDITABLE_ROLES,
  OPERATIONAL_EDITABLE_ROLES,
// Run next step: } from "../../permissions";
} from "../../permissions";
// Import module ./query for this service.
import { editableRolesFor } from "./query";

// Run next step: describe("editableRolesFor matrix", () => {
describe("editableRolesFor matrix", () => {
  // Run next step: it("owner may edit every matrix role", () => {
  it("owner may edit every matrix role", () => {
    // Run next step: assert.deepEqual(editableRolesFor(Role.owner), [...MATRIX_RO…
    assert.deepEqual(editableRolesFor(Role.owner), [...MATRIX_ROLES]);
  });

  // Run next step: it("manager and admin may edit only operational roles", () =…
  it("manager and admin may edit only operational roles", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: editableRolesFor(Role.manager),
      editableRolesFor(Role.manager),
      // Run next step: [...OPERATIONAL_EDITABLE_ROLES],
      [...OPERATIONAL_EDITABLE_ROLES],
    );
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: editableRolesFor(Role.admin),
      editableRolesFor(Role.admin),
      // Run next step: [...OPERATIONAL_EDITABLE_ROLES],
      [...OPERATIONAL_EDITABLE_ROLES],
    );
    // Iterate items to apply the same logic to each entry.
    for (const forbidden of ["manager", "admin", "owner"] as const) {
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: OPERATIONAL_EDITABLE_ROLES.includes(
        OPERATIONAL_EDITABLE_ROLES.includes(
          // Run next step: forbidden as (typeof OPERATIONAL_EDITABLE_ROLES)[number],
          forbidden as (typeof OPERATIONAL_EDITABLE_ROLES)[number],
        ),
        // Run next step: false,
        false,
      );
    }
  });

  // Run next step: it("other roles including supervisor get an empty editable l…
  it("other roles including supervisor get an empty editable list", () => {
    // Iterate items to apply the same logic to each entry.
    for (const actor of [
      // Run next step: Role.supervisor,
      Role.supervisor,
      // Run next step: Role.housekeeper,
      Role.housekeeper,
      // Run next step: Role.technician,
      Role.technician,
      // Run next step: Role.reception,
      Role.reception,
    // Run next step: ] as Role[]) {
    ] as Role[]) {
      // Run next step: assert.deepEqual(editableRolesFor(actor), []);
      assert.deepEqual(editableRolesFor(actor), []);
    }
  });
});
