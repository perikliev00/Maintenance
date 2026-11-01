/**
 * BUG-01/02 regressions: stale expectedVersion → 409; concurrent writers;
 * audit diffs match transaction before-state (not cache).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { GrantKind, PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import { withDatabaseBarrier } from "../../../tests/dbBarrier";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../../tests/fixtures";
import {
  closeServer,
  getJson,
  getRoleGrantVersion,
  listenApp,
  loginBearer,
  putRoleGrantsJson,
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
  process.env.JWT_SECRET || "test-secret-for-permissions-concurrency";

const prisma = new PrismaClient();
const GRANT_ROLES = [...MATRIX_ROLES] as Role[];

describe("permissions concurrency / optimistic version (BUG-01/02)", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";
  let snapshot: RoleGrantSnapshotRow[] = [];
  let owner: EmployeeUserFixture;
  let fixtureIds: string[] = [];

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    invalidateGrantCache();
    snapshot = await snapshotRoleGrants(prisma, GRANT_ROLES);

    const stamp = Date.now();
    owner = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-PERM-CAS-${stamp}`,
      email: `t-perm-cas-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Perm CAS Owner",
    });
    fixtureIds = [owner.employeeId];

    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  after(async () => {
    await restoreRoleGrants(prisma, GRANT_ROLES, snapshot);
    await cleanupEmployeeGraph(prisma, fixtureIds);
    if (server) await closeServer(server);
    await prisma.$disconnect();
  });

  it("BUG-01: stale expectedVersion is rejected with 409 and leaves grants unchanged", async () => {
    const localSnap = await snapshotRoleGrants(prisma, [Role.housekeeper]);
    try {
      const { token } = await loginBearer(
        api,
        owner.email,
        "test-password-t03",
      );
      const before = await getGrantsForRole(Role.housekeeper);
      const version = await getRoleGrantVersion(api, token, "housekeeper");

      const winner = await putRoleGrantsJson(api, token, "housekeeper", {
        panels: before.panels.includes("rooms")
          ? before.panels
          : [...before.panels, "rooms"],
        actions: before.actions,
        expectedVersion: version,
        reason: "cas-winner",
      });
      assert.equal(winner.status, 200);

      const afterWinner = await snapshotRoleGrants(prisma, [Role.housekeeper]);

      const stale = await putRoleGrantsJson(api, token, "housekeeper", {
        panels: ["home"],
        actions: ["rooms.view"],
        expectedVersion: version,
        reason: "cas-stale",
      });
      assert.equal(stale.status, 409);
      assert.equal((stale.body as { error?: string }).error, "stale_state");

      const afterStale = await snapshotRoleGrants(prisma, [Role.housekeeper]);
      assert.deepEqual(
        afterStale.sort((a, b) =>
          `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
        ),
        afterWinner.sort((a, b) =>
          `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
        ),
      );
    } finally {
      await restoreRoleGrants(prisma, [Role.housekeeper], localSnap);
    }
  });

  it("BUG-01: concurrent PUTs on same role → one 200 and one 409", async () => {
    const localSnap = await snapshotRoleGrants(prisma, [Role.technician]);
    try {
      const { token } = await loginBearer(
        api,
        owner.email,
        "test-password-t03",
      );
      const current = await getGrantsForRole(Role.technician);
      const version = await getRoleGrantVersion(api, token, "technician");

      const bodyA = {
        panels: current.panels.includes("repairs")
          ? current.panels.filter((p) => p !== "repairs")
          : [...current.panels, "repairs"],
        actions: current.actions,
        expectedVersion: version,
        reason: "race-a",
      };
      const bodyB = {
        panels: current.panels,
        actions: current.actions.includes("tickets.report")
          ? current.actions.filter((a) => a !== "tickets.report")
          : [...current.actions, "tickets.report"],
        expectedVersion: version,
        reason: "race-b",
      };

      const [r1, r2] = await withDatabaseBarrier(
        prisma,
        (tx) =>
          tx.$queryRaw`
            SELECT version FROM "RoleGrantRevision"
            WHERE role = CAST('technician' AS "Role")
            FOR UPDATE
          `,
        () =>
          Promise.all([
            putRoleGrantsJson(api, token, "technician", bodyA),
            putRoleGrantsJson(api, token, "technician", bodyB),
          ]),
      );

      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 409]);
      const winner = r1.status === 200 ? r1 : r2;
      assert.equal(
        (winner.body as { version?: number }).version,
        version + 1,
      );
    } finally {
      await restoreRoleGrants(prisma, [Role.technician], localSnap);
    }
  });

  it("BUG-02: audit rows match transactional before-state under contention", async () => {
    const localSnap = await snapshotRoleGrants(prisma, [Role.reception]);
    try {
      const { token } = await loginBearer(
        api,
        owner.email,
        "test-password-t03",
      );
      const current = await getGrantsForRole(Role.reception);
      const version = await getRoleGrantVersion(api, token, "reception");
      const reason = `audit-race-${Date.now()}`;

      // Seed a known starting point via API so version + grants align.
      const baselinePanels = current.panels.includes("home")
        ? current.panels
        : [...current.panels, "home"];
      const baselineActions = current.actions.includes("rooms.view")
        ? current.actions
        : [...current.actions, "rooms.view"];
      const baseline = await putRoleGrantsJson(api, token, "reception", {
        panels: baselinePanels,
        actions: baselineActions,
        expectedVersion: version,
        reason: `${reason}-baseline`,
      });
      assert.equal(baseline.status, 200);
      const v2 = (baseline.body as { version: number }).version;

      // reception defaults omit audit.view — force a real grant transition.
      const grantAudit = await putRoleGrantsJson(api, token, "reception", {
        panels: baselinePanels.includes("audit")
          ? baselinePanels
          : [...baselinePanels, "audit"],
        actions: baselineActions.includes("audit.view")
          ? baselineActions
          : [...baselineActions, "audit.view"],
        expectedVersion: v2,
        reason,
      });
      assert.equal(grantAudit.status, 200);

      const rows = await prisma.auditEvent.findMany({
        where: { reason },
        orderBy: { occurredAt: "asc" },
      });
      assert.ok(rows.length >= 1);
      for (const row of rows) {
        assert.equal(row.entityType, "role_grant");
        assert.match(row.entityId, /^reception:/);
        assert.ok(
          row.action === "permission.grant" || row.action === "permission.revoke",
        );
      }
      const grant = rows.find(
        (r) =>
          r.action === "permission.grant" &&
          r.entityId === "reception:action:audit.view",
      );
      assert.ok(grant, "expected grant audit for audit.view");
      assert.deepEqual(grant.after, {
        role: "reception",
        kind: GrantKind.action,
        key: "audit.view",
        granted: true,
      });

      // Stale writer must not invent extra audit rows.
      const stale = await putRoleGrantsJson(api, token, "reception", {
        panels: ["home"],
        actions: ["rooms.view"],
        expectedVersion: v2,
        reason: `${reason}-stale`,
      });
      assert.equal(stale.status, 409);
      const staleAudits = await prisma.auditEvent.findMany({
        where: { reason: `${reason}-stale` },
      });
      assert.equal(staleAudits.length, 0);
    } finally {
      await restoreRoleGrants(prisma, [Role.reception], localSnap);
    }
  });

  it("BUG-08: invalid history limit returns 400", async () => {
    const { token } = await loginBearer(api, owner.email, "test-password-t03");
    const bad = await getJson(api, token, "/permissions/history?limit=abc");
    assert.equal(bad.status, 400);
    assert.equal((bad.body as { error?: string }).error, "validation");

    const ok = await getJson(api, token, "/permissions/history?limit=10");
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body));
  });
});
