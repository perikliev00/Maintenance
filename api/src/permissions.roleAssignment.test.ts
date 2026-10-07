import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import {
  assignableRolesFor,
  canChangeUserRole,
  isPrivilegedRole,
} from "./permissions";

describe("role assignment policy", () => {
  it("only owner may assign privileged roles", () => {
    assert.ok(assignableRolesFor(Role.owner).includes(Role.owner));
    assert.ok(assignableRolesFor(Role.owner).includes(Role.admin));

    for (const actor of [
      Role.manager,
      Role.supervisor,
      Role.admin,
      Role.reception,
    ] as Role[]) {
      assert.equal(assignableRolesFor(actor).includes(Role.owner), false);
      assert.equal(assignableRolesFor(actor).includes(Role.admin), false);
    }
  });

  it("non-owners may still assign operational and manager roles", () => {
    for (const actor of [Role.manager, Role.supervisor] as Role[]) {
      assert.ok(assignableRolesFor(actor).includes(Role.manager));
      assert.ok(assignableRolesFor(actor).includes(Role.supervisor));
      assert.ok(assignableRolesFor(actor).includes(Role.housekeeper));
    }
  });

  it("marks owner and admin as privileged", () => {
    assert.equal(isPrivilegedRole(Role.owner), true);
    assert.equal(isPrivilegedRole(Role.admin), true);
    assert.equal(isPrivilegedRole(Role.manager), false);
    assert.equal(isPrivilegedRole(Role.supervisor), false);
  });

  it("blocks the delegated-supervisor escalate-to-owner sequence", () => {
    // Manager demotes self to supervisor (allowed).
    assert.equal(
      canChangeUserRole(Role.manager, Role.manager, Role.supervisor),
      true,
    );
    // After re-login as supervisor with people.change_role, cannot become owner.
    assert.equal(
      canChangeUserRole(Role.supervisor, Role.supervisor, Role.owner),
      false,
    );
    assert.equal(
      canChangeUserRole(Role.supervisor, Role.supervisor, Role.admin),
      false,
    );
  });

  it("manager cannot assign or modify owner/admin users", () => {
    assert.equal(
      canChangeUserRole(Role.manager, Role.housekeeper, Role.owner),
      false,
    );
    assert.equal(
      canChangeUserRole(Role.manager, Role.housekeeper, Role.admin),
      false,
    );
    assert.equal(
      canChangeUserRole(Role.manager, Role.owner, Role.manager),
      false,
    );
    assert.equal(
      canChangeUserRole(Role.manager, Role.admin, Role.supervisor),
      false,
    );
  });

  it("owner can assign and modify privileged roles", () => {
    assert.equal(
      canChangeUserRole(Role.owner, Role.manager, Role.owner),
      true,
    );
    assert.equal(
      canChangeUserRole(Role.owner, Role.owner, Role.admin),
      true,
    );
    assert.equal(
      canChangeUserRole(Role.owner, Role.admin, Role.manager),
      true,
    );
  });

  it("invite-equivalent: non-owner cannot assign owner/admin", () => {
    for (const actor of [Role.manager, Role.supervisor] as Role[]) {
      assert.equal(assignableRolesFor(actor).includes(Role.owner), false);
      assert.equal(assignableRolesFor(actor).includes(Role.admin), false);
    }
  });
});
