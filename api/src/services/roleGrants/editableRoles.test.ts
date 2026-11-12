import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import {
  MATRIX_ROLES,
  OPERATIONAL_EDITABLE_ROLES,
} from "../../permissions";
import { editableRolesFor } from "./query";

describe("editableRolesFor matrix", () => {
  it("owner may edit every matrix role", () => {
    assert.deepEqual(editableRolesFor(Role.owner), [...MATRIX_ROLES]);
  });

  it("manager and admin may edit only operational roles", () => {
    assert.deepEqual(
      editableRolesFor(Role.manager),
      [...OPERATIONAL_EDITABLE_ROLES],
    );
    assert.deepEqual(
      editableRolesFor(Role.admin),
      [...OPERATIONAL_EDITABLE_ROLES],
    );
    // Iterate items to apply the same logic to each entry.
    for (const forbidden of ["manager", "admin", "owner"] as const) {
      assert.equal(
        OPERATIONAL_EDITABLE_ROLES.includes(
          forbidden as (typeof OPERATIONAL_EDITABLE_ROLES)[number],
        ),
        false,
      );
    }
  });

  it("other roles including supervisor get an empty editable list", () => {
    // Iterate items to apply the same logic to each entry.
    for (const actor of [
      Role.supervisor,
      Role.housekeeper,
      Role.technician,
      Role.reception,
    ] as Role[]) {
      assert.deepEqual(editableRolesFor(actor), []);
    }
  });
});
