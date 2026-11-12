// Strict assertions for role-assignment policy helpers.
import assert from "node:assert/strict";
// Node test runner suite helpers.
import { describe, it } from "node:test";
// Prisma Role enum values used as actors/targets in cases.
import { Role } from "@prisma/client";
// Policy helpers under test.
import {
  // Support the surrounding logic for this step.
  assignableRolesFor,
  // Support the surrounding logic for this step.
  canChangeUserRole,
  // Support the surrounding logic for this step.
  isPrivilegedRole,
// Support the surrounding logic for this step.
} from "./permissions";

// Group related tests under a shared suite name.
describe("role assignment policy", () => {
  // Only the owner role may place someone into owner or admin.
  it("only owner may assign privileged roles", () => {
    // Invoke assert.ok to perform this step.
    assert.ok(assignableRolesFor(Role.owner).includes(Role.owner));
    // Invoke assert.ok to perform this step.
    assert.ok(assignableRolesFor(Role.owner).includes(Role.admin));

    // Sample of non-owner actors that must not see privileged targets.
    for (const actor of [
      // Support the surrounding logic for this step.
      Role.manager,
      // Support the surrounding logic for this step.
      Role.supervisor,
      // Support the surrounding logic for this step.
      Role.admin,
      // Support the surrounding logic for this step.
      Role.reception,
    // Support the surrounding logic for this step.
    ] as Role[]) {
      // Invoke assert.equal to perform this step.
      assert.equal(assignableRolesFor(actor).includes(Role.owner), false);
      // Invoke assert.equal to perform this step.
      assert.equal(assignableRolesFor(actor).includes(Role.admin), false);
    }
  });

  // Non-owners can still manage operational/manager roles within policy.
  it("non-owners may still assign operational and manager roles", () => {
    // Iterate a collection or counted range.
    for (const actor of [Role.manager, Role.supervisor] as Role[]) {
      // Invoke assert.ok to perform this step.
      assert.ok(assignableRolesFor(actor).includes(Role.manager));
      // Invoke assert.ok to perform this step.
      assert.ok(assignableRolesFor(actor).includes(Role.supervisor));
      // Invoke assert.ok to perform this step.
      assert.ok(assignableRolesFor(actor).includes(Role.housekeeper));
    }
  });

  // isPrivilegedRole is the shared predicate for owner/admin gates.
  it("marks owner and admin as privileged", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(isPrivilegedRole(Role.owner), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isPrivilegedRole(Role.admin), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isPrivilegedRole(Role.manager), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isPrivilegedRole(Role.supervisor), false);
  });

  // Regression: demote-then-escalate path must not reach owner/admin.
  it("blocks the delegated-supervisor escalate-to-owner sequence", () => {
    // Manager demotes self to supervisor (allowed).
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.manager, Role.manager, Role.supervisor),
      // Support the surrounding logic for this step.
      true,
    );
    // After re-login as supervisor with people.change_role, cannot become owner.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.supervisor, Role.supervisor, Role.owner),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.supervisor, Role.supervisor, Role.admin),
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Managers cannot assign privileged roles or edit privileged users.
  it("manager cannot assign or modify owner/admin users", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.manager, Role.housekeeper, Role.owner),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.manager, Role.housekeeper, Role.admin),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.manager, Role.owner, Role.manager),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.manager, Role.admin, Role.supervisor),
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Owner is unrestricted for privileged role changes.
  it("owner can assign and modify privileged roles", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.owner, Role.manager, Role.owner),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.owner, Role.owner, Role.admin),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke canChangeUserRole to perform this step.
      canChangeUserRole(Role.owner, Role.admin, Role.manager),
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Invite flows reuse assignableRolesFor — same privileged exclusions.
  it("invite-equivalent: non-owner cannot assign owner/admin", () => {
    // Iterate a collection or counted range.
    for (const actor of [Role.manager, Role.supervisor] as Role[]) {
      // Invoke assert.equal to perform this step.
      assert.equal(assignableRolesFor(actor).includes(Role.owner), false);
      // Invoke assert.equal to perform this step.
      assert.equal(assignableRolesFor(actor).includes(Role.admin), false);
    }
  });
});
