import { withDatabaseBarrier } from "../../../tests/dbBarrier";
/**
 * HTTP integration: T-PERM-HTTP-01/01b/01c, T-PERM-LAST-01/02, T-GRANT-HTTP-01.
 * Mutates shared RoleGrant rows — always snapshot/restore.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { GrantKind, PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  cleanupScopeSmokeFixture,
  createEmployeeWithUser,
  createScopeSmokeFixture,
  type EmployeeUserFixture,
  type ScopeSmokeFixture,
} from "../../../tests/fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  postJson,
  putJson,
  restoreRoleGrants,
  snapshotRoleGrants,
  type RoleGrantSnapshotRow,
} from "../../../tests/httpHarness";
import { MATRIX_ROLES } from "../../permissions";
import {
  ensureDefaultRoleGrants,
  getGrantsForRole,
  invalidateGrantCache,
} from "./index";

dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-permissions-http";

const prisma = new PrismaClient();
const GRANT_ROLES = [...MATRIX_ROLES] as Role[];

describe("permissions HTTP (P0-09 / P1-04 / P1-01 / P1-05)", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";
  let snapshot: RoleGrantSnapshotRow[] = [];
  let manager: EmployeeUserFixture;
  let admin: EmployeeUserFixture;
  let supervisor: EmployeeUserFixture;
  let owner: EmployeeUserFixture;
  let fixtureIds: string[] = [];
  let scopeFx: ScopeSmokeFixture | null = null;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    invalidateGrantCache();
    snapshot = await snapshotRoleGrants(prisma, GRANT_ROLES);

    const stamp = Date.now();
    manager = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-PERM-MGR-${stamp}`,
      email: `t-perm-mgr-${stamp}@test.local`,
      role: Role.manager,
      fullName: "T Perm Manager",
    });
    admin = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-PERM-ADM-${stamp}`,
      email: `t-perm-adm-${stamp}@test.local`,
      role: Role.admin,
      fullName: "T Perm Admin",
    });
    supervisor = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-PERM-SUP-${stamp}`,
      email: `t-perm-sup-${stamp}@test.local`,
      role: Role.supervisor,
      fullName: "T Perm Supervisor",
    });
    owner = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-PERM-OWN-${stamp}`,
      email: `t-perm-own-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Perm Owner",
    });
    fixtureIds = [
      manager.employeeId,
      admin.employeeId,
      supervisor.employeeId,
      owner.employeeId,
    ];

    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  after(async () => {
    await restoreRoleGrants(prisma, GRANT_ROLES, snapshot);
    if (scopeFx) {
      await cleanupScopeSmokeFixture(prisma, scopeFx).catch(() => undefined);
    }
    await cleanupEmployeeGraph(prisma, fixtureIds);
    if (server) await closeServer(server);
    await prisma.$disconnect();
  });

  function sortGrantSnap(rows: RoleGrantSnapshotRow[]) {
    return [...rows].sort((a, b) =>
      `${a.role}:${a.kind}:${a.key}`.localeCompare(
        `${b.role}:${b.kind}:${b.key}`,
      ),
    );
  }

  async function assertPrivilegedRoleDenials(token: string) {
    const privilegedSnap = sortGrantSnap(
      await snapshotRoleGrants(prisma, [Role.manager, Role.admin, Role.owner]),
    );

    const denyMgr = await putJson(api, token, "/permissions/roles/manager", {
      panels: ["home"],
      actions: ["rooms.view"],
    });
    assert.equal(denyMgr.status, 403);
    assert.equal(
      (denyMgr.body as { message?: string }).message,
      "You cannot edit grants for this role",
    );

    const denyAdmin = await putJson(api, token, "/permissions/roles/admin", {
      panels: ["home"],
      actions: ["rooms.view"],
    });
    assert.equal(denyAdmin.status, 403);
    assert.equal(
      (denyAdmin.body as { message?: string }).message,
      "You cannot edit grants for this role",
    );

    const denyOwner = await putJson(api, token, "/permissions/roles/owner", {
      panels: ["home"],
      actions: ["rooms.view"],
    });
    assert.equal(denyOwner.status, 400);
    assert.equal(
      (denyOwner.body as { message?: string }).message,
      "Owner grants cannot be edited",
    );

    const after = sortGrantSnap(
      await snapshotRoleGrants(prisma, [Role.manager, Role.admin, Role.owner]),
    );
    assert.deepEqual(
      after,
      privilegedSnap,
      "denied PUTs must leave manager/admin/owner grants unchanged",
    );
  }

  it("T-PERM-HTTP-01: manager may edit housekeeper; denied for manager/admin/owner", async () => {
    const localSnap = await snapshotRoleGrants(prisma, [Role.housekeeper]);
    try {
      const { token } = await loginBearer(
        api,
        manager.email,
        "test-password-t03",
      );
      const hk = await getGrantsForRole(Role.housekeeper);
      const ok = await putJson(api, token, "/permissions/roles/housekeeper", {
        panels: hk.panels,
        actions: hk.actions,
      });
      assert.equal(ok.status, 200, `housekeeper put → ${ok.status}`);

      await assertPrivilegedRoleDenials(token);
    } finally {
      await restoreRoleGrants(prisma, [Role.housekeeper], localSnap);
    }
  });

  it("T-PERM-HTTP-01b: admin denied for manager/admin/owner", async () => {
    const { token } = await loginBearer(api, admin.email, "test-password-t03");
    const hk = await getGrantsForRole(Role.housekeeper);
    const ok = await putJson(api, token, "/permissions/roles/housekeeper", {
      panels: hk.panels,
      actions: hk.actions,
    });
    assert.equal(ok.status, 200, `admin housekeeper put → ${ok.status}`);
    await assertPrivilegedRoleDenials(token);
  });

  it("T-PERM-HTTP-01c: delegated supervisor with permissions.manage cannot edit any role", async () => {
    const localSnap = await snapshotRoleGrants(prisma, [
      Role.supervisor,
      Role.housekeeper,
    ]);
    try {
      const { token: ownerTok } = await loginBearer(
        api,
        owner.email,
        "test-password-t03",
      );
      const sup = await getGrantsForRole(Role.supervisor);
      const panels = sup.panels.includes("permissions")
        ? sup.panels
        : [...sup.panels, "permissions"];
      const actions = sup.actions.includes("permissions.manage")
        ? sup.actions
        : [...sup.actions, "permissions.manage"];
      const grant = await putJson(api, ownerTok, "/permissions/roles/supervisor", {
        panels,
        actions,
      });
      assert.equal(grant.status, 200, `delegate put → ${grant.status}`);

      const { token } = await loginBearer(
        api,
        supervisor.email,
        "test-password-t03",
      );

      const denyHk = await putJson(api, token, "/permissions/roles/housekeeper", {
        panels: ["home"],
        actions: ["rooms.view"],
      });
      assert.equal(denyHk.status, 403);
      assert.equal(
        (denyHk.body as { message?: string }).message,
        "You cannot edit grants for this role",
      );

      await assertPrivilegedRoleDenials(token);
    } finally {
      await restoreRoleGrants(
        prisma,
        [Role.supervisor, Role.housekeeper],
        localSnap,
      );
    }
  });

  it("T-PERM-LAST-01: cannot remove last permissions.manage", async () => {
    const localSnap = await snapshotRoleGrants(prisma, GRANT_ROLES);
    try {
      // Leave manage only on manager.
      for (const role of MATRIX_ROLES) {
        if (role === "manager") continue;
        await prisma.roleGrant.deleteMany({
          where: {
            role,
            kind: GrantKind.action,
            key: "permissions.manage",
          },
        });
      }
      invalidateGrantCache();

      const mgrGrants = await getGrantsForRole(Role.manager);
      const { token } = await loginBearer(api, owner.email, "test-password-t03");
      const res = await putJson(api, token, "/permissions/roles/manager", {
        panels: mgrGrants.panels.filter((p) => p !== "permissions"),
        actions: mgrGrants.actions.filter((a) => a !== "permissions.manage"),
      });
      assert.equal(res.status, 400);
      assert.equal(
        (res.body as { message?: string }).message,
        "Cannot remove the last permissions.manage grant from non-owner roles",
      );
      const still = await prisma.roleGrant.findFirst({
        where: {
          role: Role.manager,
          kind: GrantKind.action,
          key: "permissions.manage",
        },
      });
      assert.ok(still, "manager must keep permissions.manage");
    } finally {
      await restoreRoleGrants(prisma, GRANT_ROLES, localSnap);
    }
  });

  it("T-PERM-LAST-02: concurrent strip leaves ≥1 permissions.manage", async () => {
    const localSnap = await snapshotRoleGrants(prisma, GRANT_ROLES);
    try {
      // Only manager + admin keep manage.
      for (const role of MATRIX_ROLES) {
        if (role === "manager" || role === "admin") continue;
        await prisma.roleGrant.deleteMany({
          where: {
            role,
            kind: GrantKind.action,
            key: "permissions.manage",
          },
        });
      }
      // Ensure both have manage.
      for (const role of [Role.manager, Role.admin] as const) {
        await prisma.roleGrant.upsert({
          where: {
            role_kind_key: {
              role,
              kind: GrantKind.action,
              key: "permissions.manage",
            },
          },
          create: {
            role,
            kind: GrantKind.action,
            key: "permissions.manage",
          },
          update: {},
        });
        await prisma.roleGrant.upsert({
          where: {
            role_kind_key: {
              role,
              kind: GrantKind.panel,
              key: "permissions",
            },
          },
          create: {
            role,
            kind: GrantKind.panel,
            key: "permissions",
          },
          update: {},
        });
      }
      invalidateGrantCache();

      const mgrGrants = await getGrantsForRole(Role.manager);
      const adminGrants = await getGrantsForRole(Role.admin);
      const { token } = await loginBearer(api, owner.email, "test-password-t03");

      const strip = (role: "manager" | "admin", g: typeof mgrGrants) =>
        putJson(api, token, `/permissions/roles/${role}`, {
          panels: g.panels.filter((p) => p !== "permissions"),
          actions: g.actions.filter((a) => a !== "permissions.manage"),
        });

      const [r1, r2] = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT role FROM "RoleGrant" WHERE kind = CAST('action' AS "GrantKind") AND key = 'permissions.manage' ORDER BY role FOR UPDATE`, () => Promise.all([
        strip("manager", mgrGrants),
        strip("admin", adminGrants),
      ]));

      const remaining = await prisma.roleGrant.count({
        where: {
          kind: GrantKind.action,
          key: "permissions.manage",
          role: { in: [Role.manager, Role.admin] },
        },
      });
      assert.deepEqual([r1.status, r2.status].sort(), [200, 400]);
      assert.equal(remaining, 1);
      assert.ok(
        remaining >= 1,
        `expected ≥1 manage grant, got ${remaining}; statuses ${r1.status},${r2.status}`,
      );
      assert.ok(
        r1.status === 400 || r2.status === 400,
        "at least one concurrent strip should fail",
      );
    } finally {
      await restoreRoleGrants(prisma, GRANT_ROLES, localSnap);
    }
  });

  it("T-GRANT-HTTP-01: revoked action → 403 and /me omits action", async () => {
    scopeFx = await createScopeSmokeFixture(prisma);
    const localSnap = await snapshotRoleGrants(prisma, [Role.supervisor]);
    try {
      const { token } = await loginBearer(
        api,
        scopeFx.supervisorA.email,
        scopeFx.password,
      );

      const before = await postJson(
        api,
        token,
        `/rooms/${scopeFx.locAId}/mark-dirty`,
        {},
      );
      assert.ok(
        before.status === 200 || before.status === 409,
        `pre-revoke mark-dirty → ${before.status}`,
      );

      const { token: ownerTok } = await loginBearer(
        api,
        owner.email,
        "test-password-t03",
      );
      const sup = await getGrantsForRole(Role.supervisor);
      const put = await putJson(api, ownerTok, "/permissions/roles/supervisor", {
        panels: sup.panels,
        actions: sup.actions.filter((a) => a !== "rooms.mark_dirty"),
      });
      assert.equal(put.status, 200, `revoke put → ${put.status}`);

      const after = await postJson(
        api,
        token,
        `/rooms/${scopeFx.locAId}/mark-dirty`,
        {},
      );
      assert.equal(after.status, 403);
      assert.equal(
        (after.body as { error?: string }).error,
        "forbidden",
      );
      assert.equal(
        (after.body as { message?: string }).message,
        "Insufficient permissions",
      );

      const me = await getJson(api, token, "/auth/me");
      assert.equal(me.status, 200);
      const actions = (me.body as { actions?: string[] }).actions ?? [];
      assert.equal(actions.includes("rooms.mark_dirty"), false);
    } finally {
      await restoreRoleGrants(prisma, [Role.supervisor], localSnap);
      if (scopeFx) {
        await cleanupScopeSmokeFixture(prisma, scopeFx);
        scopeFx = null;
      }
    }
  });
});
