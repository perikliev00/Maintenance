// Import module ../../../tests/dbBarrier for this service.
import { withDatabaseBarrier } from "../../../tests/dbBarrier";
/**
 * HTTP integration: /01b/01c, /02, .
 * Mutates shared RoleGrant rows — always snapshot/restore.
 */
import assert from "node:assert/strict";
// Import module node:path for this service.
import path from "node:path";
// Import module node:test for this service.
import { after, before, describe, it } from "node:test";
// Import module @prisma/client for this service.
import { GrantKind, PrismaClient, Role } from "@prisma/client";
// Import module dotenv for this service.
import dotenv from "dotenv";
// Import module dependency for this service.
import {
  // Run next step: cleanupEmployeeGraph,
  cleanupEmployeeGraph,
  // Run next step: cleanupScopeSmokeFixture,
  cleanupScopeSmokeFixture,
  // Run next step: createEmployeeWithUser,
  createEmployeeWithUser,
  // Run next step: createScopeSmokeFixture,
  createScopeSmokeFixture,
  // Declare type EmployeeUserFixture for callers and internals.
  type EmployeeUserFixture,
  // Declare type ScopeSmokeFixture for callers and internals.
  type ScopeSmokeFixture,
// Run next step: } from "../../../tests/fixtures";
} from "../../../tests/fixtures";
// Import module dependency for this service.
import {
  // Run next step: closeServer,
  closeServer,
  // Run next step: getJson,
  getJson,
  // Run next step: getRoleGrantVersion,
  getRoleGrantVersion,
  // Run next step: listenApp,
  listenApp,
  // Run next step: loginBearer,
  loginBearer,
  // Run next step: postJson,
  postJson,
  // Run next step: putJson,
  putJson,
  // Run next step: putRoleGrantsJson,
  putRoleGrantsJson,
  // Run next step: restoreRoleGrants,
  restoreRoleGrants,
  // Run next step: snapshotRoleGrants,
  snapshotRoleGrants,
  // Declare type RoleGrantSnapshotRow for callers and internals.
  type RoleGrantSnapshotRow,
// Run next step: } from "../../../tests/httpHarness";
} from "../../../tests/httpHarness";
// Import module ../../permissions for this service.
import { MATRIX_ROLES } from "../../permissions";
// Import module dependency for this service.
import {
  // Run next step: ensureDefaultRoleGrants,
  ensureDefaultRoleGrants,
  // Run next step: getGrantsForRole,
  getGrantsForRole,
  // Run next step: invalidateGrantCache,
  invalidateGrantCache,
// Run next step: } from "./index";
} from "./index";

// Run next step: dotenv.config({
dotenv.config({
  // Set path on the structure being built.
  path: path.resolve(__dirname, "../../../.env"),
  // Set override on the structure being built.
  override: true,
});
// Run next step: process.env.JWT_SECRET =
process.env.JWT_SECRET =
  // Run next step: process.env.JWT_SECRET || "test-secret-for-permissions-http"…
  process.env.JWT_SECRET || "test-secret-for-permissions-http";

// Capture prisma for use in this scope.
const prisma = new PrismaClient();
// Collect grant roles list for later processing.
const GRANT_ROLES = [...MATRIX_ROLES] as Role[];

// Run next step: describe("permissions HTTP", () => {
describe("permissions HTTP", () => {
  // Capture server for use in this scope.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Capture api for use in this scope.
  let api = "";
  // Capture snapshot for use in this scope.
  let snapshot: RoleGrantSnapshotRow[] = [];
  // Capture manager for use in this scope.
  let manager: EmployeeUserFixture;
  // Capture admin for use in this scope.
  let admin: EmployeeUserFixture;
  // Capture supervisor for use in this scope.
  let supervisor: EmployeeUserFixture;
  // Capture owner for use in this scope.
  let owner: EmployeeUserFixture;
  // Capture fixture ids for use in this scope.
  let fixtureIds: string[] = [];
  // Capture scope fx for use in this scope.
  let scopeFx: ScopeSmokeFixture | null = null;

  // Run next step: before(async () => {
  before(async () => {
    // Run next step: assert.ok(process.env.DATABASE_URL, "DATABASE_URL required")…
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Wait for the async step before continuing.
    await ensureDefaultRoleGrants();
    // Run next step: invalidateGrantCache();
    invalidateGrantCache();
    // Update snapshot as control flow progresses.
    snapshot = await snapshotRoleGrants(prisma, GRANT_ROLES);

    // Capture stamp for use in this scope.
    const stamp = Date.now();
    // Update manager as control flow progresses.
    manager = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-PERM-MGR-${stamp}`,
      // Set email on the structure being built.
      email: `t-perm-mgr-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.manager,
      // Set fullName on the structure being built.
      fullName: "T Perm Manager",
    });
    // Update admin as control flow progresses.
    admin = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-PERM-ADM-${stamp}`,
      // Set email on the structure being built.
      email: `t-perm-adm-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.admin,
      // Set fullName on the structure being built.
      fullName: "T Perm Admin",
    });
    // Update supervisor as control flow progresses.
    supervisor = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-PERM-SUP-${stamp}`,
      // Set email on the structure being built.
      email: `t-perm-sup-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.supervisor,
      // Set fullName on the structure being built.
      fullName: "T Perm Supervisor",
    });
    // Update owner as control flow progresses.
    owner = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-PERM-OWN-${stamp}`,
      // Set email on the structure being built.
      email: `t-perm-own-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.owner,
      // Set fullName on the structure being built.
      fullName: "T Perm Owner",
    });
    // Update fixture ids as control flow progresses.
    fixtureIds = [
      // Run next step: manager.employeeId,
      manager.employeeId,
      // Run next step: admin.employeeId,
      admin.employeeId,
      // Run next step: supervisor.employeeId,
      supervisor.employeeId,
      // Run next step: owner.employeeId,
      owner.employeeId,
    ];

    // Load listened asynchronously for the next steps.
    const listened = await listenApp();
    // Update server as control flow progresses.
    server = listened.server;
    // Update api as control flow progresses.
    api = listened.api;
  });

  // Run next step: after(async () => {
  after(async () => {
    // Wait for the async step before continuing.
    await restoreRoleGrants(prisma, GRANT_ROLES, snapshot);
    // Branch when this condition holds so the right path runs.
    if (scopeFx) {
      // Wait for the async step before continuing.
      await cleanupScopeSmokeFixture(prisma, scopeFx).catch(() => undefined);
    }
    // Wait for the async step before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Branch when this condition holds so the right path runs.
    if (server) await closeServer(server);
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  });

  // Define sortGrantSnap — core behavior for this module.
  function sortGrantSnap(rows: RoleGrantSnapshotRow[]) {
    // Return the computed result to the caller.
    return [...rows].sort((a, b) =>
      // Run next step: `${a.role}:${a.kind}:${a.key}`.localeCompare(
      `${a.role}:${a.kind}:${a.key}`.localeCompare(
        // Run next step: `${b.role}:${b.kind}:${b.key}`,
        `${b.role}:${b.kind}:${b.key}`,
      ),
    );
  }

  // Define assertPrivilegedRoleDenials — core behavior for this module.
  async function assertPrivilegedRoleDenials(token: string) {
    // Capture privileged snap for use in this scope.
    const privilegedSnap = sortGrantSnap(
      // Wait for the async step before continuing.
      await snapshotRoleGrants(prisma, [Role.manager, Role.admin, Role.owner]),
    );

    // Load deny mgr asynchronously for the next steps.
    const denyMgr = await putRoleGrantsJson(api, token, "manager", {
      // Set panels on the structure being built.
      panels: ["home"],
      // Set actions on the structure being built.
      actions: ["rooms.view"],
      // Set expectedVersion on the structure being built.
      expectedVersion: 1,
    });
    // Run next step: assert.equal(denyMgr.status, 403);
    assert.equal(denyMgr.status, 403);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: (denyMgr.body as { message?: string }).message,
      (denyMgr.body as { message?: string }).message,
      // Run next step: "You cannot edit grants for this role",
      "You cannot edit grants for this role",
    );

    // Load deny admin asynchronously for the next steps.
    const denyAdmin = await putRoleGrantsJson(api, token, "admin", {
      // Set panels on the structure being built.
      panels: ["home"],
      // Set actions on the structure being built.
      actions: ["rooms.view"],
      // Set expectedVersion on the structure being built.
      expectedVersion: 1,
    });
    // Run next step: assert.equal(denyAdmin.status, 403);
    assert.equal(denyAdmin.status, 403);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: (denyAdmin.body as { message?: string }).message,
      (denyAdmin.body as { message?: string }).message,
      // Run next step: "You cannot edit grants for this role",
      "You cannot edit grants for this role",
    );

    // Load deny owner asynchronously for the next steps.
    const denyOwner = await putJson(api, token, "/permissions/roles/owner", {
      // Set panels on the structure being built.
      panels: ["home"],
      // Set actions on the structure being built.
      actions: ["rooms.view"],
      // Set expectedVersion on the structure being built.
      expectedVersion: 1,
    });
    // Run next step: assert.equal(denyOwner.status, 400);
    assert.equal(denyOwner.status, 400);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: (denyOwner.body as { message?: string }).message,
      (denyOwner.body as { message?: string }).message,
      // Run next step: "Owner grants cannot be edited",
      "Owner grants cannot be edited",
    );

    // Capture after for use in this scope.
    const after = sortGrantSnap(
      // Wait for the async step before continuing.
      await snapshotRoleGrants(prisma, [Role.manager, Role.admin, Role.owner]),
    );
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: after,
      after,
      // Run next step: privilegedSnap,
      privilegedSnap,
      // Run next step: "denied PUTs must leave manager/admin/owner grants unchanged…
      "denied PUTs must leave manager/admin/owner grants unchanged",
    );
  }

  // Run next step: it("manager may edit housekeeper; denied for manager/admin/o…
  it("manager may edit housekeeper; denied for manager/admin/owner", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.housekeeper]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: manager.email,
        manager.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Load hk asynchronously for the next steps.
      const hk = await getGrantsForRole(Role.housekeeper);
      // Load ok asynchronously for the next steps.
      const ok = await putRoleGrantsJson(api, token, "housekeeper", {
        // Set panels on the structure being built.
        panels: hk.panels,
        // Set actions on the structure being built.
        actions: hk.actions,
      });
      // Run next step: assert.equal(ok.status, 200, `housekeeper put → ${ok.status}…
      assert.equal(ok.status, 200, `housekeeper put → ${ok.status}`);

      // Wait for the async step before continuing.
      await assertPrivilegedRoleDenials(token);
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, [Role.housekeeper], localSnap);
    }
  });

  // Run next step: it("admin denied for manager/admin/owner", async () => {
  it("admin denied for manager/admin/owner", async () => {
    // Load value asynchronously for the next steps.
    const { token } = await loginBearer(api, admin.email, "test-password-t03");
    // Load hk asynchronously for the next steps.
    const hk = await getGrantsForRole(Role.housekeeper);
    // Load ok asynchronously for the next steps.
    const ok = await putRoleGrantsJson(api, token, "housekeeper", {
      // Set panels on the structure being built.
      panels: hk.panels,
      // Set actions on the structure being built.
      actions: hk.actions,
    });
    // Run next step: assert.equal(ok.status, 200, `admin housekeeper put → ${ok.s…
    assert.equal(ok.status, 200, `admin housekeeper put → ${ok.status}`);
    // Wait for the async step before continuing.
    await assertPrivilegedRoleDenials(token);
  });

  // Run next step: it("delegated supervisor with permissions.manage cannot edit…
  it("delegated supervisor with permissions.manage cannot edit any role", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [
      // Run next step: Role.supervisor,
      Role.supervisor,
      // Run next step: Role.housekeeper,
      Role.housekeeper,
    ]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token: ownerTok } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: owner.email,
        owner.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Load sup asynchronously for the next steps.
      const sup = await getGrantsForRole(Role.supervisor);
      // Capture panels for use in this scope.
      const panels = sup.panels.includes("permissions")
        // Complete the ternary or optional chain started above.
        ? sup.panels
        // Complete the ternary or optional chain started above.
        : [...sup.panels, "permissions"];
      // Capture actions for use in this scope.
      const actions = sup.actions.includes("permissions.manage")
        // Complete the ternary or optional chain started above.
        ? sup.actions
        // Complete the ternary or optional chain started above.
        : [...sup.actions, "permissions.manage"];
      // Load grant asynchronously for the next steps.
      const grant = await putRoleGrantsJson(api, ownerTok, "supervisor", {
        // Run next step: panels,
        panels,
        // Run next step: actions,
        actions,
      });
      // Run next step: assert.equal(grant.status, 200, `delegate put → ${grant.stat…
      assert.equal(grant.status, 200, `delegate put → ${grant.status}`);

      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: supervisor.email,
        supervisor.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );

      // Load deny hk asynchronously for the next steps.
      const denyHk = await putRoleGrantsJson(api, token, "housekeeper", {
        // Set panels on the structure being built.
        panels: ["home"],
        // Set actions on the structure being built.
        actions: ["rooms.view"],
        // Set expectedVersion on the structure being built.
        expectedVersion: 1,
      });
      // Run next step: assert.equal(denyHk.status, 403);
      assert.equal(denyHk.status, 403);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (denyHk.body as { message?: string }).message,
        (denyHk.body as { message?: string }).message,
        // Run next step: "You cannot edit grants for this role",
        "You cannot edit grants for this role",
      );

      // Wait for the async step before continuing.
      await assertPrivilegedRoleDenials(token);
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(
        // Run next step: prisma,
        prisma,
        // Run next step: [Role.supervisor, Role.housekeeper],
        [Role.supervisor, Role.housekeeper],
        // Run next step: localSnap,
        localSnap,
      );
    }
  });

  // Run next step: it("cannot remove last permissions.manage", async () => {
  it("cannot remove last permissions.manage", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, GRANT_ROLES);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Leave manage only on manager.
      for (const role of MATRIX_ROLES) {
        // Branch when this condition holds so the right path runs.
        if (role === "manager") continue;
        // Wait for the async step before continuing.
        await prisma.roleGrant.deleteMany({
          // Set where on the structure being built.
          where: {
            // Run next step: role,
            role,
            // Set kind on the structure being built.
            kind: GrantKind.action,
            // Set key on the structure being built.
            key: "permissions.manage",
          },
        });
      }
      // Run next step: invalidateGrantCache();
      invalidateGrantCache();

      // Load mgr grants asynchronously for the next steps.
      const mgrGrants = await getGrantsForRole(Role.manager);
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(api, owner.email, "test-password-t03");
      // Load res asynchronously for the next steps.
      const res = await putRoleGrantsJson(api, token, "manager", {
        // Set panels on the structure being built.
        panels: mgrGrants.panels.filter((p) => p !== "permissions"),
        // Set actions on the structure being built.
        actions: mgrGrants.actions.filter((a) => a !== "permissions.manage"),
      });
      // Run next step: assert.equal(res.status, 400);
      assert.equal(res.status, 400);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (res.body as { message?: string }).message,
        (res.body as { message?: string }).message,
        // Run next step: "Cannot remove the last permissions.manage grant from non-ow…
        "Cannot remove the last permissions.manage grant from non-owner roles",
      );
      // Load still asynchronously for the next steps.
      const still = await prisma.roleGrant.findFirst({
        // Set where on the structure being built.
        where: {
          // Set role on the structure being built.
          role: Role.manager,
          // Set kind on the structure being built.
          kind: GrantKind.action,
          // Set key on the structure being built.
          key: "permissions.manage",
        },
      });
      // Run next step: assert.ok(still, "manager must keep permissions.manage");
      assert.ok(still, "manager must keep permissions.manage");
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, GRANT_ROLES, localSnap);
    }
  });

  // Run next step: it("concurrent strip leaves ≥1 permissions.manage", async ()…
  it("concurrent strip leaves ≥1 permissions.manage", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, GRANT_ROLES);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Only manager + admin keep manage.
      for (const role of MATRIX_ROLES) {
        // Branch when this condition holds so the right path runs.
        if (role === "manager" || role === "admin") continue;
        // Wait for the async step before continuing.
        await prisma.roleGrant.deleteMany({
          // Set where on the structure being built.
          where: {
            // Run next step: role,
            role,
            // Set kind on the structure being built.
            kind: GrantKind.action,
            // Set key on the structure being built.
            key: "permissions.manage",
          },
        });
      }
      // Ensure both have manage.
      for (const role of [Role.manager, Role.admin] as const) {
        // Wait for the async step before continuing.
        await prisma.roleGrant.upsert({
          // Set where on the structure being built.
          where: {
            // Set role_kind_key on the structure being built.
            role_kind_key: {
              // Run next step: role,
              role,
              // Set kind on the structure being built.
              kind: GrantKind.action,
              // Set key on the structure being built.
              key: "permissions.manage",
            },
          },
          // Set create on the structure being built.
          create: {
            // Run next step: role,
            role,
            // Set kind on the structure being built.
            kind: GrantKind.action,
            // Set key on the structure being built.
            key: "permissions.manage",
          },
          // Set update on the structure being built.
          update: {},
        });
        // Wait for the async step before continuing.
        await prisma.roleGrant.upsert({
          // Set where on the structure being built.
          where: {
            // Set role_kind_key on the structure being built.
            role_kind_key: {
              // Run next step: role,
              role,
              // Set kind on the structure being built.
              kind: GrantKind.panel,
              // Set key on the structure being built.
              key: "permissions",
            },
          },
          // Set create on the structure being built.
          create: {
            // Run next step: role,
            role,
            // Set kind on the structure being built.
            kind: GrantKind.panel,
            // Set key on the structure being built.
            key: "permissions",
          },
          // Set update on the structure being built.
          update: {},
        });
      }
      // Run next step: invalidateGrantCache();
      invalidateGrantCache();

      // Load mgr grants asynchronously for the next steps.
      const mgrGrants = await getGrantsForRole(Role.manager);
      // Load admin grants asynchronously for the next steps.
      const adminGrants = await getGrantsForRole(Role.admin);
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(api, owner.email, "test-password-t03");

      // Load mgr ver asynchronously for the next steps.
      const mgrVer = await getRoleGrantVersion(api, token, "manager");
      // Load admin ver asynchronously for the next steps.
      const adminVer = await getRoleGrantVersion(api, token, "admin");
      // Define strip as a callable used by this flow.
      const strip = (
        // Set role on the structure being built.
        role: "manager" | "admin",
        // Set g on the structure being built.
        g: typeof mgrGrants,
        // Set expectedVersion on the structure being built.
        expectedVersion: number,
      // Run next step: ) =>
      ) =>
        // Run next step: putRoleGrantsJson(api, token, role, {
        putRoleGrantsJson(api, token, role, {
          // Set panels on the structure being built.
          panels: g.panels.filter((p) => p !== "permissions"),
          // Set actions on the structure being built.
          actions: g.actions.filter((a) => a !== "permissions.manage"),
          // Run next step: expectedVersion,
          expectedVersion,
        });

      // Load value asynchronously for the next steps.
      const [r1, r2] = await withDatabaseBarrier(
        // Run next step: prisma,
        prisma,
        // Run next step: (tx) =>
        (tx) =>
          // Run next step: tx.$executeRaw`SELECT pg_advisory_xact_lock(87201401)`,
          tx.$executeRaw`SELECT pg_advisory_xact_lock(87201401)`,
        // Run next step: () =>
        () =>
          // Run next step: Promise.all([
          Promise.all([
            // Run next step: strip("manager", mgrGrants, mgrVer),
            strip("manager", mgrGrants, mgrVer),
            // Run next step: strip("admin", adminGrants, adminVer),
            strip("admin", adminGrants, adminVer),
          ]),
      );

      // Load remaining asynchronously for the next steps.
      const remaining = await prisma.roleGrant.count({
        // Set where on the structure being built.
        where: {
          // Set kind on the structure being built.
          kind: GrantKind.action,
          // Set key on the structure being built.
          key: "permissions.manage",
          // Set role on the structure being built.
          role: { in: [Role.manager, Role.admin] },
        },
      });
      // Run next step: assert.deepEqual([r1.status, r2.status].sort(), [200, 400]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 400]);
      // Run next step: assert.equal(remaining, 1);
      assert.equal(remaining, 1);
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: remaining >= 1,
        remaining >= 1,
        // Run next step: `expected ≥1 manage grant, got ${remaining}; statuses ${r1.s…
        `expected ≥1 manage grant, got ${remaining}; statuses ${r1.status},${r2.status}`,
      );
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: r1.status === 400 || r2.status === 400,
        r1.status === 400 || r2.status === 400,
        // Run next step: "at least one concurrent strip should fail",
        "at least one concurrent strip should fail",
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, GRANT_ROLES, localSnap);
    }
  });

  // Run next step: it("revoked action → 403 and /me omits action", async () => …
  it("revoked action → 403 and /me omits action", async () => {
    // Update scope fx as control flow progresses.
    scopeFx = await createScopeSmokeFixture(prisma);
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.supervisor]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: scopeFx.supervisorA.email,
        scopeFx.supervisorA.email,
        // Run next step: scopeFx.password,
        scopeFx.password,
      );

      // Load before asynchronously for the next steps.
      const before = await postJson(
        // Run next step: api,
        api,
        // Run next step: token,
        token,
        // Run next step: `/rooms/${scopeFx.locAId}/mark-dirty`,
        `/rooms/${scopeFx.locAId}/mark-dirty`,
        // Run next step: {},
        {},
      );
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: before.status === 200 || before.status === 409,
        before.status === 200 || before.status === 409,
        // Run next step: `pre-revoke mark-dirty → ${before.status}`,
        `pre-revoke mark-dirty → ${before.status}`,
      );

      // Load value asynchronously for the next steps.
      const { token: ownerTok } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: owner.email,
        owner.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Load sup asynchronously for the next steps.
      const sup = await getGrantsForRole(Role.supervisor);
      // Load put asynchronously for the next steps.
      const put = await putRoleGrantsJson(api, ownerTok, "supervisor", {
        // Set panels on the structure being built.
        panels: sup.panels,
        // Set actions on the structure being built.
        actions: sup.actions.filter((a) => a !== "rooms.mark_dirty"),
      });
      // Run next step: assert.equal(put.status, 200, `revoke put → ${put.status}`);
      assert.equal(put.status, 200, `revoke put → ${put.status}`);

      // Load after asynchronously for the next steps.
      const after = await postJson(
        // Run next step: api,
        api,
        // Run next step: token,
        token,
        // Run next step: `/rooms/${scopeFx.locAId}/mark-dirty`,
        `/rooms/${scopeFx.locAId}/mark-dirty`,
        // Run next step: {},
        {},
      );
      // Run next step: assert.equal(after.status, 403);
      assert.equal(after.status, 403);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (after.body as { error?: string }).error,
        (after.body as { error?: string }).error,
        // Run next step: "forbidden",
        "forbidden",
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (after.body as { message?: string }).message,
        (after.body as { message?: string }).message,
        // Run next step: "Insufficient permissions",
        "Insufficient permissions",
      );

      // Load me asynchronously for the next steps.
      const me = await getJson(api, token, "/auth/me");
      // Run next step: assert.equal(me.status, 200);
      assert.equal(me.status, 200);
      // Define actions as a callable used by this flow.
      const actions = (me.body as { actions?: string[] }).actions ?? [];
      // Run next step: assert.equal(actions.includes("rooms.mark_dirty"), false);
      assert.equal(actions.includes("rooms.mark_dirty"), false);
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, [Role.supervisor], localSnap);
      // Branch when this condition holds so the right path runs.
      if (scopeFx) {
        // Wait for the async step before continuing.
        await cleanupScopeSmokeFixture(prisma, scopeFx);
        // Update scope fx as control flow progresses.
        scopeFx = null;
      }
    }
  });
});
