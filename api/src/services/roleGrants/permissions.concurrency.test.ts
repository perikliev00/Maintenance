/**
 * regressions: stale expectedVersion → 409; concurrent writers;
 * audit diffs match transaction before-state (not cache).
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
// Import module ../../../tests/dbBarrier for this service.
import { withDatabaseBarrier } from "../../../tests/dbBarrier";
// Import module dependency for this service.
import {
  // Run next step: cleanupEmployeeGraph,
  cleanupEmployeeGraph,
  // Run next step: createEmployeeWithUser,
  createEmployeeWithUser,
  // Declare type EmployeeUserFixture for callers and internals.
  type EmployeeUserFixture,
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
  // Run next step: process.env.JWT_SECRET || "test-secret-for-permissions-concu…
  process.env.JWT_SECRET || "test-secret-for-permissions-concurrency";

// Capture prisma for use in this scope.
const prisma = new PrismaClient();
// Collect grant roles list for later processing.
const GRANT_ROLES = [...MATRIX_ROLES] as Role[];

// Run next step: describe("permissions concurrency / optimistic version", () …
describe("permissions concurrency / optimistic version", () => {
  // Capture server for use in this scope.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Capture api for use in this scope.
  let api = "";
  // Capture snapshot for use in this scope.
  let snapshot: RoleGrantSnapshotRow[] = [];
  // Capture owner for use in this scope.
  let owner: EmployeeUserFixture;
  // Capture fixture ids for use in this scope.
  let fixtureIds: string[] = [];

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
    // Update owner as control flow progresses.
    owner = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-PERM-CAS-${stamp}`,
      // Set email on the structure being built.
      email: `t-perm-cas-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.owner,
      // Set fullName on the structure being built.
      fullName: "T Perm CAS Owner",
    });
    // Update fixture ids as control flow progresses.
    fixtureIds = [owner.employeeId];

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
    // Wait for the async step before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Branch when this condition holds so the right path runs.
    if (server) await closeServer(server);
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  });

  // Run next step: it("stale expectedVersion is rejected with 409 and leaves gr…
  it("stale expectedVersion is rejected with 409 and leaves grants unchanged", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.housekeeper]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: owner.email,
        owner.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Load before asynchronously for the next steps.
      const before = await getGrantsForRole(Role.housekeeper);
      // Load version asynchronously for the next steps.
      const version = await getRoleGrantVersion(api, token, "housekeeper");

      // Load winner asynchronously for the next steps.
      const winner = await putRoleGrantsJson(api, token, "housekeeper", {
        // Set panels on the structure being built.
        panels: before.panels.includes("rooms")
          // Complete the ternary or optional chain started above.
          ? before.panels
          // Complete the ternary or optional chain started above.
          : [...before.panels, "rooms"],
        // Set actions on the structure being built.
        actions: before.actions,
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
        // Set reason on the structure being built.
        reason: "cas-winner",
      });
      // Run next step: assert.equal(winner.status, 200);
      assert.equal(winner.status, 200);

      // Load after winner asynchronously for the next steps.
      const afterWinner = await snapshotRoleGrants(prisma, [Role.housekeeper]);

      // Load stale asynchronously for the next steps.
      const stale = await putRoleGrantsJson(api, token, "housekeeper", {
        // Set panels on the structure being built.
        panels: ["home"],
        // Set actions on the structure being built.
        actions: ["rooms.view"],
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
        // Set reason on the structure being built.
        reason: "cas-stale",
      });
      // Run next step: assert.equal(stale.status, 409);
      assert.equal(stale.status, 409);
      // Run next step: assert.equal((stale.body as { error?: string }).error, "stal…
      assert.equal((stale.body as { error?: string }).error, "stale_state");

      // Load after stale asynchronously for the next steps.
      const afterStale = await snapshotRoleGrants(prisma, [Role.housekeeper]);
      // Run next step: assert.deepEqual(
      assert.deepEqual(
        // Run next step: afterStale.sort((a, b) =>
        afterStale.sort((a, b) =>
          // Run next step: `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
          `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
        ),
        // Run next step: afterWinner.sort((a, b) =>
        afterWinner.sort((a, b) =>
          // Run next step: `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
          `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
        ),
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, [Role.housekeeper], localSnap);
    }
  });

  // Run next step: it("concurrent PUTs on same role → one 200 and one 409", asy…
  it("concurrent PUTs on same role → one 200 and one 409", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.technician]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: owner.email,
        owner.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Load current asynchronously for the next steps.
      const current = await getGrantsForRole(Role.technician);
      // Load version asynchronously for the next steps.
      const version = await getRoleGrantVersion(api, token, "technician");

      // Build body a object holding related fields.
      const bodyA = {
        // Set panels on the structure being built.
        panels: current.panels.includes("repairs")
          // Complete the ternary or optional chain started above.
          ? current.panels.filter((p) => p !== "repairs")
          // Complete the ternary or optional chain started above.
          : [...current.panels, "repairs"],
        // Set actions on the structure being built.
        actions: current.actions,
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
        // Set reason on the structure being built.
        reason: "race-a",
      };
      // Build body b object holding related fields.
      const bodyB = {
        // Set panels on the structure being built.
        panels: current.panels,
        // Set actions on the structure being built.
        actions: current.actions.includes("tickets.report")
          // Complete the ternary or optional chain started above.
          ? current.actions.filter((a) => a !== "tickets.report")
          // Complete the ternary or optional chain started above.
          : [...current.actions, "tickets.report"],
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
        // Set reason on the structure being built.
        reason: "race-b",
      };

      // Load value asynchronously for the next steps.
      const [r1, r2] = await withDatabaseBarrier(
        // Run next step: prisma,
        prisma,
        // Run next step: (tx) =>
        (tx) =>
          // Run next step: tx.$queryRaw`
          tx.$queryRaw`
            SELECT version FROM "RoleGrantRevision"
            WHERE role = CAST('technician' AS "Role")
            FOR UPDATE
          `,
        // Run next step: () =>
        () =>
          // Run next step: Promise.all([
          Promise.all([
            // Run next step: putRoleGrantsJson(api, token, "technician", bodyA),
            putRoleGrantsJson(api, token, "technician", bodyA),
            // Run next step: putRoleGrantsJson(api, token, "technician", bodyB),
            putRoleGrantsJson(api, token, "technician", bodyB),
          ]),
      );

      // Collect statuses list for later processing.
      const statuses = [r1.status, r2.status].sort();
      // Run next step: assert.deepEqual(statuses, [200, 409]);
      assert.deepEqual(statuses, [200, 409]);
      // Capture winner for use in this scope.
      const winner = r1.status === 200 ? r1 : r2;
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (winner.body as { version?: number }).version,
        (winner.body as { version?: number }).version,
        // Run next step: version + 1,
        version + 1,
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, [Role.technician], localSnap);
    }
  });

  // Run next step: it("audit rows match transactional before-state under conten…
  it("audit rows match transactional before-state under contention", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.reception]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: owner.email,
        owner.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Load current asynchronously for the next steps.
      const current = await getGrantsForRole(Role.reception);
      // Load version asynchronously for the next steps.
      const version = await getRoleGrantVersion(api, token, "reception");
      // Capture reason for use in this scope.
      const reason = `audit-race-${Date.now()}`;

      // Seed a known starting point via API so version + grants align.
      const baselinePanels = current.panels.includes("home")
        // Complete the ternary or optional chain started above.
        ? current.panels
        // Complete the ternary or optional chain started above.
        : [...current.panels, "home"];
      // Capture baseline actions for use in this scope.
      const baselineActions = current.actions.includes("rooms.view")
        // Complete the ternary or optional chain started above.
        ? current.actions
        // Complete the ternary or optional chain started above.
        : [...current.actions, "rooms.view"];
      // Load baseline asynchronously for the next steps.
      const baseline = await putRoleGrantsJson(api, token, "reception", {
        // Set panels on the structure being built.
        panels: baselinePanels,
        // Set actions on the structure being built.
        actions: baselineActions,
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
        // Set reason on the structure being built.
        reason: `${reason}-baseline`,
      });
      // Run next step: assert.equal(baseline.status, 200);
      assert.equal(baseline.status, 200);
      // Define v2 as a callable used by this flow.
      const v2 = (baseline.body as { version: number }).version;

      // reception defaults omit audit.view — force a real grant transition.
      const grantAudit = await putRoleGrantsJson(api, token, "reception", {
        // Set panels on the structure being built.
        panels: baselinePanels.includes("audit")
          // Complete the ternary or optional chain started above.
          ? baselinePanels
          // Complete the ternary or optional chain started above.
          : [...baselinePanels, "audit"],
        // Set actions on the structure being built.
        actions: baselineActions.includes("audit.view")
          // Complete the ternary or optional chain started above.
          ? baselineActions
          // Complete the ternary or optional chain started above.
          : [...baselineActions, "audit.view"],
        // Set expectedVersion on the structure being built.
        expectedVersion: v2,
        // Run next step: reason,
        reason,
      });
      // Run next step: assert.equal(grantAudit.status, 200);
      assert.equal(grantAudit.status, 200);

      // Load rows asynchronously for the next steps.
      const rows = await prisma.auditEvent.findMany({
        // Set where on the structure being built.
        where: { reason },
        // Set orderBy on the structure being built.
        orderBy: { occurredAt: "asc" },
      });
      // Run next step: assert.ok(rows.length >= 1);
      assert.ok(rows.length >= 1);
      // Iterate items to apply the same logic to each entry.
      for (const row of rows) {
        // Run next step: assert.equal(row.entityType, "role_grant");
        assert.equal(row.entityType, "role_grant");
        // Run next step: assert.match(row.entityId, /^reception:/);
        assert.match(row.entityId, /^reception:/);
        // Run next step: assert.ok(
        assert.ok(
          // Run next step: row.action === "permission.grant" || row.action === "permiss…
          row.action === "permission.grant" || row.action === "permission.revoke",
        );
      }
      // Capture grant for use in this scope.
      const grant = rows.find(
        // Run next step: (r) =>
        (r) =>
          // Run next step: r.action === "permission.grant" &&
          r.action === "permission.grant" &&
          // Run next step: r.entityId === "reception:action:audit.view",
          r.entityId === "reception:action:audit.view",
      );
      // Run next step: assert.ok(grant, "expected grant audit for audit.view");
      assert.ok(grant, "expected grant audit for audit.view");
      // Run next step: assert.deepEqual(grant.after, {
      assert.deepEqual(grant.after, {
        // Set role on the structure being built.
        role: "reception",
        // Set kind on the structure being built.
        kind: GrantKind.action,
        // Set key on the structure being built.
        key: "audit.view",
        // Set granted on the structure being built.
        granted: true,
      });

      // Stale writer must not invent extra audit rows.
      const stale = await putRoleGrantsJson(api, token, "reception", {
        // Set panels on the structure being built.
        panels: ["home"],
        // Set actions on the structure being built.
        actions: ["rooms.view"],
        // Set expectedVersion on the structure being built.
        expectedVersion: v2,
        // Set reason on the structure being built.
        reason: `${reason}-stale`,
      });
      // Run next step: assert.equal(stale.status, 409);
      assert.equal(stale.status, 409);
      // Load stale audits asynchronously for the next steps.
      const staleAudits = await prisma.auditEvent.findMany({
        // Set where on the structure being built.
        where: { reason: `${reason}-stale` },
      });
      // Run next step: assert.equal(staleAudits.length, 0);
      assert.equal(staleAudits.length, 0);
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, [Role.reception], localSnap);
    }
  });

  // Run next step: it("invalid history limit returns 400", async () => {
  it("invalid history limit returns 400", async () => {
    // Load value asynchronously for the next steps.
    const { token } = await loginBearer(api, owner.email, "test-password-t03");
    // Load bad asynchronously for the next steps.
    const bad = await getJson(api, token, "/permissions/history?limit=abc");
    // Run next step: assert.equal(bad.status, 400);
    assert.equal(bad.status, 400);
    // Run next step: assert.equal((bad.body as { error?: string }).error, "valida…
    assert.equal((bad.body as { error?: string }).error, "validation");

    // Load ok asynchronously for the next steps.
    const ok = await getJson(api, token, "/permissions/history?limit=10");
    // Run next step: assert.equal(ok.status, 200);
    assert.equal(ok.status, 200);
    // Run next step: assert.ok(Array.isArray(ok.body));
    assert.ok(Array.isArray(ok.body));
  });
});
