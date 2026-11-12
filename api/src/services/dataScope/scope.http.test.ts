/**
 * HTTP integration:
 * 02, .
 */
import assert from "node:assert/strict";
// Import module node:crypto for this service.
import { randomUUID } from "node:crypto";
// Import module node:path for this service.
import path from "node:path";
// Import module node:test for this service.
import { after, before, describe, it } from "node:test";
// Import module @prisma/client for this service.
import { PrismaClient, Role } from "@prisma/client";
// Import module dotenv for this service.
import dotenv from "dotenv";
// Import module dependency for this service.
import {
  // Run next step: cleanupAggregateSeed,
  cleanupAggregateSeed,
  // Run next step: cleanupEmployeeGraph,
  cleanupEmployeeGraph,
  // Run next step: cleanupScopeSmokeFixture,
  cleanupScopeSmokeFixture,
  // Run next step: createEmployeeWithUser,
  createEmployeeWithUser,
  // Run next step: createScopeSmokeFixture,
  createScopeSmokeFixture,
  // Run next step: seedScopeAggregateExtras,
  seedScopeAggregateExtras,
  // Declare type AggregateSeedIds for callers and internals.
  type AggregateSeedIds,
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
  // Run next step: listenApp,
  listenApp,
  // Run next step: loginBearer,
  loginBearer,
  // Run next step: patchJson,
  patchJson,
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
// Import module dependency for this service.
import {
  // Run next step: ensureDefaultRoleGrants,
  ensureDefaultRoleGrants,
  // Run next step: getGrantsForRole,
  getGrantsForRole,
  // Run next step: invalidateGrantCache,
  invalidateGrantCache,
// Run next step: } from "../roleGrants";
} from "../roleGrants";

// Run next step: dotenv.config({
dotenv.config({
  // Set path on the structure being built.
  path: path.resolve(__dirname, "../../../.env"),
  // Set override on the structure being built.
  override: true,
});
// Run next step: process.env.JWT_SECRET =
process.env.JWT_SECRET =
  // Run next step: process.env.JWT_SECRET || "test-secret-for-scope-http";
  process.env.JWT_SECRET || "test-secret-for-scope-http";

// Capture prisma for use in this scope.
const prisma = new PrismaClient();
// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

// Define assertOutOfScope — core behavior for this module.
function assertOutOfScope(res: { status: number; body: unknown }, label: string) {
  // Run next step: assert.equal(res.status, 403, `${label} → ${res.status} ${JS…
  assert.equal(res.status, 403, `${label} → ${res.status} ${JSON.stringify(res.body)}`);
  // Run next step: assert.equal((res.body as { error?: string }).error, "forbid…
  assert.equal((res.body as { error?: string }).error, "forbidden");
  // Run next step: assert.equal((res.body as { message?: string }).message, OUT…
  assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
}

// Run next step: describe("dataScope HTTP", () => {
describe("dataScope HTTP", () => {
  // Capture server for use in this scope.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Capture api for use in this scope.
  let api = "";
  // Capture fx for use in this scope.
  let fx: ScopeSmokeFixture;
  // Capture technician for use in this scope.
  let technician: EmployeeUserFixture;
  // Capture owner for use in this scope.
  let owner: EmployeeUserFixture;
  // Capture grant snap for use in this scope.
  let grantSnap: RoleGrantSnapshotRow[] = [];

  // Run next step: before(async () => {
  before(async () => {
    // Run next step: assert.ok(process.env.DATABASE_URL, "DATABASE_URL required")…
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Wait for the async step before continuing.
    await ensureDefaultRoleGrants();
    // Run next step: invalidateGrantCache();
    invalidateGrantCache();
    // Update grant snap as control flow progresses.
    grantSnap = await snapshotRoleGrants(prisma, [
      // Run next step: Role.supervisor,
      Role.supervisor,
      // Run next step: Role.manager,
      Role.manager,
      // Run next step: Role.admin,
      Role.admin,
    ]);

    // Update fx as control flow progresses.
    fx = await createScopeSmokeFixture(prisma);
    // Capture stamp for use in this scope.
    const stamp = Date.now();
    // Update technician as control flow progresses.
    technician = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-SCOPE-TECH-${stamp}`,
      // Set email on the structure being built.
      email: `t-scope-tech-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.technician,
      // Set fullName on the structure being built.
      fullName: "T Scope Tech",
    });
    // Update owner as control flow progresses.
    owner = await createEmployeeWithUser(prisma, {
      // Set employeeNumber on the structure being built.
      employeeNumber: `T-SCOPE-OWN-${stamp}`,
      // Set email on the structure being built.
      email: `t-scope-own-${stamp}@test.local`,
      // Set role on the structure being built.
      role: Role.owner,
      // Set fullName on the structure being built.
      fullName: "T Scope Owner",
    });

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
    await restoreRoleGrants(
      // Run next step: prisma,
      prisma,
      // Run next step: [Role.supervisor, Role.manager, Role.admin],
      [Role.supervisor, Role.manager, Role.admin],
      // Run next step: grantSnap,
      grantSnap,
    );
    // Branch when this condition holds so the right path runs.
    if (server) await closeServer(server);
    // Wait for the async step before continuing.
    await cleanupEmployeeGraph(prisma, [
      // Run next step: technician.employeeId,
      technician.employeeId,
      // Run next step: owner.employeeId,
      owner.employeeId,
    ]);
    // Wait for the async step before continuing.
    await cleanupScopeSmokeFixture(prisma, fx);
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  });

  // Run next step: it("OOS location mutations denied", async () => {
  it("OOS location mutations denied", async () => {
    // Load value asynchronously for the next steps.
    const { token } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.supervisorA.email,
      fx.supervisorA.email,
      // Run next step: fx.password,
      fx.password,
    );
    // Load loc asynchronously for the next steps.
    const loc = await prisma.location.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: fx.locBId },
    });

    // Run next step: assertOutOfScope(
    assertOutOfScope(
      // Wait for the async step before continuing.
      await postJson(api, token, `/rooms/${fx.locBId}/mark-dirty`, {}),
      // Run next step: "mark-dirty",
      "mark-dirty",
    );
    // Run next step: assertOutOfScope(
    assertOutOfScope(
      // Wait for the async step before continuing.
      await patchJson(api, token, `/locations/${fx.locBId}/occupancy`, {
        // Set occupancy on the structure being built.
        occupancy: "vacant",
      }),
      // Run next step: "occupancy",
      "occupancy",
    );
    // Run next step: assertOutOfScope(
    assertOutOfScope(
      // Wait for the async step before continuing.
      await patchJson(api, token, `/locations/${fx.locBId}/service-status`, {
        // Set serviceStatus on the structure being built.
        serviceStatus: "in_service",
      }),
      // Run next step: "service-status",
      "service-status",
    );
    // Run next step: assertOutOfScope(
    assertOutOfScope(
      // Wait for the async step before continuing.
      await postJson(api, token, `/locations/${fx.locBId}/archive`, {}),
      // Run next step: "archive",
      "archive",
    );
    // Run next step: assertOutOfScope(
    assertOutOfScope(
      // Wait for the async step before continuing.
      await patchJson(api, token, `/locations/${fx.locBId}`, {
        // Set number on the structure being built.
        number: "OOS-SHOULD-FAIL",
      }),
      // Run next step: "catalog update",
      "catalog update",
    );

    // Load after asynchronously for the next steps.
    const after = await prisma.location.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: fx.locBId },
    });
    // Run next step: assert.equal(after.occupancy, loc.occupancy);
    assert.equal(after.occupancy, loc.occupancy);
    // Run next step: assert.equal(after.serviceStatus, loc.serviceStatus);
    assert.equal(after.serviceStatus, loc.serviceStatus);
    // Run next step: assert.equal(after.catalogStatus, loc.catalogStatus);
    assert.equal(after.catalogStatus, loc.catalogStatus);
    // Run next step: assert.equal(after.cleaningStatus, loc.cleaningStatus);
    assert.equal(after.cleaningStatus, loc.cleaningStatus);
    // Run next step: assert.equal(after.number, loc.number);
    assert.equal(after.number, loc.number);
  });

  // Run next step: it("OOS GET detail has no cleaningStatus side effects", asyn…
  it("OOS GET detail has no cleaningStatus side effects", async () => {
    // Load value asynchronously for the next steps.
    const { token } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.supervisorA.email,
      fx.supervisorA.email,
      // Run next step: fx.password,
      fx.password,
    );
    // Load original asynchronously for the next steps.
    const original = await prisma.location.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: fx.locBId },
      // Set select on the structure being built.
      select: { cleaningStatus: true },
    });
    // Seed an orphan status that a GET-side reconcile would previously "heal".
    await prisma.location.update({
      // Set where on the structure being built.
      where: { id: fx.locBId },
      // Set data on the structure being built.
      data: { cleaningStatus: "in_progress" },
    });

    // Run next step: assertOutOfScope(
    assertOutOfScope(
      // Wait for the async step before continuing.
      await getJson(api, token, `/rooms/${fx.locBId}`),
      // Run next step: "GET room detail",
      "GET room detail",
    );

    // Load after asynchronously for the next steps.
    const after = await prisma.location.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: fx.locBId },
      // Set select on the structure being built.
      select: { cleaningStatus: true },
    });
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: after.cleaningStatus,
      after.cleaningStatus,
      // Run next step: "in_progress",
      "in_progress",
      // Run next step: "OOS GET must not mutate cleaningStatus",
      "OOS GET must not mutate cleaningStatus",
    );

    // Restore fixture status for later tests.
    await prisma.location.update({
      // Set where on the structure being built.
      where: { id: fx.locBId },
      // Set data on the structure being built.
      data: { cleaningStatus: original.cleaningStatus },
    });
  });

  // Run next step: it("OOS ticket lifecycle denied", async () => {
  it("OOS ticket lifecycle denied", async () => {
    // Load value asynchronously for the next steps.
    const { token } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.supervisorA.email,
      fx.supervisorA.email,
      // Run next step: fx.password,
      fx.password,
    );
    // Load before asynchronously for the next steps.
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: fx.ticketBId },
    });

    // Capture routes for use in this scope.
    const routes: Array<{ path: string; body: Record<string, unknown> }> = [
      // Run next step: {
      {
        // Set path on the structure being built.
        path: `/maintenance/tickets/${fx.ticketBId}/assign`,
        // Set body on the structure being built.
        body: { assigneeId: technician.employeeId },
      },
      // Run next step: { path: `/maintenance/tickets/${fx.ticketBId}/start`, body: …
      { path: `/maintenance/tickets/${fx.ticketBId}/start`, body: {} },
      // Run next step: { path: `/maintenance/tickets/${fx.ticketBId}/wait`, body: {…
      { path: `/maintenance/tickets/${fx.ticketBId}/wait`, body: {} },
      // Run next step: { path: `/maintenance/tickets/${fx.ticketBId}/resume`, body:…
      { path: `/maintenance/tickets/${fx.ticketBId}/resume`, body: {} },
      // Run next step: { path: `/maintenance/tickets/${fx.ticketBId}/resolve`, body…
      { path: `/maintenance/tickets/${fx.ticketBId}/resolve`, body: {} },
      // Run next step: { path: `/maintenance/tickets/${fx.ticketBId}/close`, body: …
      { path: `/maintenance/tickets/${fx.ticketBId}/close`, body: {} },
      // Run next step: { path: `/maintenance/tickets/${fx.ticketBId}/reopen`, body:…
      { path: `/maintenance/tickets/${fx.ticketBId}/reopen`, body: {} },
    ];

    // Iterate items to apply the same logic to each entry.
    for (const r of routes) {
      // Run next step: assertOutOfScope(
      assertOutOfScope(
        // Wait for the async step before continuing.
        await postJson(api, token, r.path, r.body),
        // Run next step: r.path,
        r.path,
      );
    }

    // Load after asynchronously for the next steps.
    const after = await prisma.maintenanceTicket.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: fx.ticketBId },
    });
    // Run next step: assert.equal(after.status, before.status);
    assert.equal(after.status, before.status);
    // Run next step: assert.equal(after.assigneeId, before.assigneeId);
    assert.equal(after.assigneeId, before.assigneeId);
  });

  // Run next step: it("omit/swap locationId for location-only audit", async () …
  it("omit/swap locationId for location-only audit", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.supervisor]);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load g asynchronously for the next steps.
      const g = await getGrantsForRole(Role.supervisor);
      // Ensure location-only audit: operations.view_live, no full-audit actions.
      const { token: ownerTok } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: owner.email,
        owner.email,
        // Run next step: "test-password-t03",
        "test-password-t03",
      );
      // Capture actions for use in this scope.
      const actions = g.actions.filter(
        // Run next step: (a) =>
        (a) =>
          // Run next step: a !== "audit.view" &&
          a !== "audit.view" &&
          // Run next step: a !== "settings.manage" &&
          a !== "settings.manage" &&
          // Run next step: a !== "permissions.manage",
          a !== "permissions.manage",
      );
      // Branch when this condition holds so the right path runs.
      if (!actions.includes("operations.view_live")) {
        // Append an entry to the accumulating collection.
        actions.push("operations.view_live");
      }
      // Load put asynchronously for the next steps.
      const put = await putRoleGrantsJson(api, ownerTok, "supervisor", {
        // Set panels on the structure being built.
        panels: g.panels,
        // Run next step: actions,
        actions,
      });
      // Run next step: assert.equal(put.status, 200);
      assert.equal(put.status, 200);

      // Load value asynchronously for the next steps.
      const { token } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: fx.supervisorA.email,
        fx.supervisorA.email,
        // Run next step: fx.password,
        fx.password,
      );

      // Load omit asynchronously for the next steps.
      const omit = await getJson(api, token, "/audit");
      // Run next step: assert.equal(omit.status, 403);
      assert.equal(omit.status, 403);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (omit.body as { message?: string }).message,
        (omit.body as { message?: string }).message,
        // Run next step: "Insufficient permissions",
        "Insufficient permissions",
      );

      // Load own asynchronously for the next steps.
      const own = await getJson(
        // Run next step: api,
        api,
        // Run next step: token,
        token,
        // Run next step: `/audit?locationId=${encodeURIComponent(fx.locAId)}`,
        `/audit?locationId=${encodeURIComponent(fx.locAId)}`,
      );
      // Run next step: assert.equal(own.status, 200);
      assert.equal(own.status, 200);
      // Run next step: assert.ok(Array.isArray(own.body));
      assert.ok(Array.isArray(own.body));
      // Define ids as a callable used by this flow.
      const ids = (own.body as Array<{ id: string }>).map((e) => e.id);
      // Run next step: assert.ok(ids.includes(fx.auditOwnId));
      assert.ok(ids.includes(fx.auditOwnId));
      // Run next step: assert.equal(ids.includes(fx.auditForeignId), false);
      assert.equal(ids.includes(fx.auditForeignId), false);

      // Run next step: assertOutOfScope(
      assertOutOfScope(
        // Wait for the async step before continuing.
        await getJson(
          // Run next step: api,
          api,
          // Run next step: token,
          token,
          // Run next step: `/audit?locationId=${encodeURIComponent(fx.locBId)}`,
          `/audit?locationId=${encodeURIComponent(fx.locBId)}`,
        ),
        // Run next step: "audit foreign location",
        "audit foreign location",
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await restoreRoleGrants(prisma, [Role.supervisor], localSnap);
    }
  });

  // Run next step: it("sector deactivate refreshes next read/action", async () …
  it("sector deactivate refreshes next read/action", async () => {
    // Load value asynchronously for the next steps.
    const { token: mgrTok } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.manager.email,
      fx.manager.email,
      // Run next step: fx.password,
      fx.password,
    );
    // Load value asynchronously for the next steps.
    const { token: supTok } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.supervisorA.email,
      fx.supervisorA.email,
      // Run next step: fx.password,
      fx.password,
    );

    // Load rooms before asynchronously for the next steps.
    const roomsBefore = await getJson(api, supTok, "/rooms");
    // Run next step: assert.equal(roomsBefore.status, 200);
    assert.equal(roomsBefore.status, 200);
    // Define idsBefore as a callable used by this flow.
    const idsBefore = (roomsBefore.body as Array<{ id: string }>).map(
      // Run next step: (r) => r.id,
      (r) => r.id,
    );
    // Run next step: assert.ok(idsBefore.includes(fx.locAId));
    assert.ok(idsBefore.includes(fx.locAId));

    // Load sector get asynchronously for the next steps.
    const sectorGet = await getJson(api, mgrTok, `/sectors/${fx.sectorAId}`);
    // Run next step: assert.equal(sectorGet.status, 200);
    assert.equal(sectorGet.status, 200);
    // Capture version for use in this scope.
    let version = (sectorGet.body as { version: number }).version;

    // Load deact asynchronously for the next steps.
    const deact = await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
      // Set isActive on the structure being built.
      isActive: false,
      // Set expectedVersion on the structure being built.
      expectedVersion: version,
    });
    // Run next step: assert.equal(deact.status, 200, JSON.stringify(deact.body));
    assert.equal(deact.status, 200, JSON.stringify(deact.body));
    // Update version as control flow progresses.
    version = (deact.body as { version: number }).version;

    // Attempt the fallible work so errors can be handled below.
    try {
      // Load rooms after asynchronously for the next steps.
      const roomsAfter = await getJson(api, supTok, "/rooms");
      // Run next step: assert.equal(roomsAfter.status, 200);
      assert.equal(roomsAfter.status, 200);
      // Define idsAfter as a callable used by this flow.
      const idsAfter = (roomsAfter.body as Array<{ id: string }>).map(
        // Run next step: (r) => r.id,
        (r) => r.id,
      );
      // Run next step: assert.equal(idsAfter.includes(fx.locAId), false);
      assert.equal(idsAfter.includes(fx.locAId), false);

      // Run next step: assertOutOfScope(
      assertOutOfScope(
        // Wait for the async step before continuing.
        await postJson(api, supTok, `/rooms/${fx.locAId}/mark-dirty`, {}),
        // Run next step: "mark-dirty after deactivate",
        "mark-dirty after deactivate",
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
        // Set isActive on the structure being built.
        isActive: true,
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
      });
    }
  });

  // Run next step: it("primarySupervisor reassignment refreshes next read/actio…
  it("primarySupervisor reassignment refreshes next read/action", async () => {
    // Load value asynchronously for the next steps.
    const { token: mgrTok } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.manager.email,
      fx.manager.email,
      // Run next step: fx.password,
      fx.password,
    );
    // Load value asynchronously for the next steps.
    const { token: supTok } = await loginBearer(
      // Run next step: api,
      api,
      // Run next step: fx.supervisorA.email,
      fx.supervisorA.email,
      // Run next step: fx.password,
      fx.password,
    );

    // Load rooms before asynchronously for the next steps.
    const roomsBefore = await getJson(api, supTok, "/rooms");
    // Run next step: assert.equal(roomsBefore.status, 200);
    assert.equal(roomsBefore.status, 200);
    // Define idsBefore as a callable used by this flow.
    const idsBefore = (roomsBefore.body as Array<{ id: string }>).map(
      // Run next step: (r) => r.id,
      (r) => r.id,
    );
    // Run next step: assert.ok(idsBefore.includes(fx.locAId));
    assert.ok(idsBefore.includes(fx.locAId));

    // Load sector get asynchronously for the next steps.
    const sectorGet = await getJson(api, mgrTok, `/sectors/${fx.sectorAId}`);
    // Run next step: assert.equal(sectorGet.status, 200);
    assert.equal(sectorGet.status, 200);
    // Capture version for use in this scope.
    let version = (sectorGet.body as { version: number }).version;

    // Load reassign asynchronously for the next steps.
    const reassign = await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
      // Set primarySupervisorEmployeeId on the structure being built.
      primarySupervisorEmployeeId: fx.supervisorB.employeeId,
      // Set expectedVersion on the structure being built.
      expectedVersion: version,
    });
    // Run next step: assert.equal(reassign.status, 200, JSON.stringify(reassign.b…
    assert.equal(reassign.status, 200, JSON.stringify(reassign.body));
    // Update version as control flow progresses.
    version = (reassign.body as { version: number }).version;

    // Attempt the fallible work so errors can be handled below.
    try {
      // Load rooms after asynchronously for the next steps.
      const roomsAfter = await getJson(api, supTok, "/rooms");
      // Run next step: assert.equal(roomsAfter.status, 200);
      assert.equal(roomsAfter.status, 200);
      // Define idsAfter as a callable used by this flow.
      const idsAfter = (roomsAfter.body as Array<{ id: string }>).map(
        // Run next step: (r) => r.id,
        (r) => r.id,
      );
      // Run next step: assert.equal(idsAfter.includes(fx.locAId), false);
      assert.equal(idsAfter.includes(fx.locAId), false);

      // Run next step: assertOutOfScope(
      assertOutOfScope(
        // Wait for the async step before continuing.
        await postJson(api, supTok, `/rooms/${fx.locAId}/mark-dirty`, {}),
        // Run next step: "mark-dirty after supervisor reassignment",
        "mark-dirty after supervisor reassignment",
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
        // Set primarySupervisorEmployeeId on the structure being built.
        primarySupervisorEmployeeId: fx.supervisorA.employeeId,
        // Set expectedVersion on the structure being built.
        expectedVersion: version,
      });
    }
  });

  // Run next step: it("plan/live/results/analytics scoped aggregates", async ()…
  it("plan/live/results/analytics scoped aggregates", async () => {
    // Capture seed for use in this scope.
    let seed: AggregateSeedIds | null = null;
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load value asynchronously for the next steps.
      const { token: supTok } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: fx.supervisorA.email,
        fx.supervisorA.email,
        // Run next step: fx.password,
        fx.password,
      );
      // Load value asynchronously for the next steps.
      const { token: mgrTok } = await loginBearer(
        // Run next step: api,
        api,
        // Run next step: fx.manager.email,
        fx.manager.email,
        // Run next step: fx.password,
        fx.password,
      );

      // Shared DB may already hold seed tickets/tasks — assert deltas + fixture ids.
      const hotelDateYmd = fx.hotelDate.toISOString().slice(0, 10);
      // Declare type LiveBody for callers and internals.
      type LiveBody = {
        // Run next step: needsAttention?: Array<{
        needsAttention?: Array<{
          // Run next step: kind?: string;
          kind?: string;
          // Run next step: id?: string;
          id?: string;
          // Run next step: location?: { id?: string };
          location?: { id?: string };
        // Run next step: }>;
        }>;
        // Run next step: counts?: { blockingTickets?: number };
        counts?: { blockingTickets?: number };
      };
      // Declare type ResultsBody for callers and internals.
      type ResultsBody = {
        // Run next step: summary?: {
        summary?: {
          // Run next step: completedTasks?: number;
          completedTasks?: number;
          // Run next step: distinctRooms?: number;
          distinctRooms?: number;
          // Run next step: completedSessions?: number;
          completedSessions?: number;
        };
        // Run next step: rows?: Array<{ employeeId?: string; completedTasks?: number …
        rows?: Array<{ employeeId?: string; completedTasks?: number }>;
      };
      // Declare type AnalyticsKpis for callers and internals.
      type AnalyticsKpis = {
        // Run next step: cleanedTasks?: number;
        cleanedTasks?: number;
        // Run next step: completedSessions?: number;
        completedSessions?: number;
        // Run next step: distinctRooms?: number;
        distinctRooms?: number;
      };

      // Define liveBeforeA as a callable used by this flow.
      const liveBeforeA = (await getJson(api, supTok, "/operations/live"))
        // Continue the chained call from the previous expression.
        .body as LiveBody;
      // Define liveBeforeAll as a callable used by this flow.
      const liveBeforeAll = (await getJson(api, mgrTok, "/operations/live"))
        // Continue the chained call from the previous expression.
        .body as LiveBody;
      // Define resultsBeforeA as a callable used by this flow.
      const resultsBeforeA = (
        // Wait for the async step before continuing.
        await getJson(
          // Run next step: api,
          api,
          // Run next step: supTok,
          supTok,
          // Run next step: `/cleaning/results?from=${hotelDateYmd}&to=${hotelDateYmd}&p…
          `/cleaning/results?from=${hotelDateYmd}&to=${hotelDateYmd}&pageSize=100`,
        )
      // Run next step: ).body as ResultsBody;
      ).body as ResultsBody;
      // Define resultsBeforeAll as a callable used by this flow.
      const resultsBeforeAll = (
        // Wait for the async step before continuing.
        await getJson(
          // Run next step: api,
          api,
          // Run next step: mgrTok,
          mgrTok,
          // Run next step: `/cleaning/results?from=${hotelDateYmd}&to=${hotelDateYmd}&p…
          `/cleaning/results?from=${hotelDateYmd}&to=${hotelDateYmd}&pageSize=100`,
        )
      // Run next step: ).body as ResultsBody;
      ).body as ResultsBody;
      // Define analyticsBeforeA as a callable used by this flow.
      const analyticsBeforeA = (
        // Wait for the async step before continuing.
        await getJson(
          // Run next step: api,
          api,
          // Run next step: supTok,
          supTok,
          // Run next step: `/analytics/summary?domain=housekeeping&from=${hotelDateYmd}…
          `/analytics/summary?domain=housekeeping&from=${hotelDateYmd}&to=${hotelDateYmd}`,
        )
      // Run next step: ).body as { kpis?: AnalyticsKpis };
      ).body as { kpis?: AnalyticsKpis };
      // Define analyticsBeforeAll as a callable used by this flow.
      const analyticsBeforeAll = (
        // Wait for the async step before continuing.
        await getJson(
          // Run next step: api,
          api,
          // Run next step: mgrTok,
          mgrTok,
          // Run next step: `/analytics/summary?domain=housekeeping&from=${hotelDateYmd}…
          `/analytics/summary?domain=housekeeping&from=${hotelDateYmd}&to=${hotelDateYmd}`,
        )
      // Run next step: ).body as { kpis?: AnalyticsKpis };
      ).body as { kpis?: AnalyticsKpis };

      // Update seed as control flow progresses.
      seed = await seedScopeAggregateExtras(prisma, fx);

      // Load plan a asynchronously for the next steps.
      const planA = await getJson(
        // Run next step: api,
        api,
        // Run next step: supTok,
        supTok,
        // Run next step: `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
        `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
      );
      // Load plan all asynchronously for the next steps.
      const planAll = await getJson(
        // Run next step: api,
        api,
        // Run next step: mgrTok,
        mgrTok,
        // Run next step: `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
        `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
      );
      // Run next step: assert.equal(planA.status, 200);
      assert.equal(planA.status, 200);
      // Run next step: assert.equal(planAll.status, 200);
      assert.equal(planAll.status, 200);
      // Declare type PlanEntry for callers and internals.
      type PlanEntry = { room?: { id?: string } };
      // Collect entries a list for later processing.
      const entriesA = [
        // Run next step: ...((planA.body as { departures?: PlanEntry[] }).departures …
        ...((planA.body as { departures?: PlanEntry[] }).departures ?? []),
        // Run next step: ...((planA.body as { arrivals?: PlanEntry[] }).arrivals ?? […
        ...((planA.body as { arrivals?: PlanEntry[] }).arrivals ?? []),
        // Run next step: ...((planA.body as { priority?: PlanEntry[] }).priority ?? […
        ...((planA.body as { priority?: PlanEntry[] }).priority ?? []),
      ];
      // Collect entries all list for later processing.
      const entriesAll = [
        // Run next step: ...((planAll.body as { departures?: PlanEntry[] }).departure…
        ...((planAll.body as { departures?: PlanEntry[] }).departures ?? []),
        // Run next step: ...((planAll.body as { arrivals?: PlanEntry[] }).arrivals ??…
        ...((planAll.body as { arrivals?: PlanEntry[] }).arrivals ?? []),
        // Run next step: ...((planAll.body as { priority?: PlanEntry[] }).priority ??…
        ...((planAll.body as { priority?: PlanEntry[] }).priority ?? []),
      ];
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: entriesA.length >= 1,
        entriesA.length >= 1,
        // Run next step: `scoped plan empty: ${JSON.stringify(planA.body)}`,
        `scoped plan empty: ${JSON.stringify(planA.body)}`,
      );
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: entriesAll.length >= 2,
        entriesAll.length >= 2,
        // Run next step: `all-scope plan too small: ${JSON.stringify(planAll.body)}`,
        `all-scope plan too small: ${JSON.stringify(planAll.body)}`,
      );
      // Run next step: assert.ok(entriesA.every((e) => e.room?.id === fx.locAId));
      assert.ok(entriesA.every((e) => e.room?.id === fx.locAId));
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: entriesA.some((e) => e.room?.id === fx.locBId),
        entriesA.some((e) => e.room?.id === fx.locBId),
        // Run next step: false,
        false,
      );
      // Run next step: assert.ok(entriesA.length < entriesAll.length);
      assert.ok(entriesA.length < entriesAll.length);

      // Make fixture tickets visible on the live board.
      await prisma.maintenanceTicket.updateMany({
        // Set where on the structure being built.
        where: { id: { in: [fx.ticketAId, fx.ticketBId] } },
        // Set data on the structure being built.
        data: { blocksRoom: true },
      });

      // Load live a asynchronously for the next steps.
      const liveA = await getJson(api, supTok, "/operations/live");
      // Load live all asynchronously for the next steps.
      const liveAll = await getJson(api, mgrTok, "/operations/live");
      // Run next step: assert.equal(liveA.status, 200);
      assert.equal(liveA.status, 200);
      // Run next step: assert.equal(liveAll.status, 200);
      assert.equal(liveAll.status, 200);
      // Capture live body a for use in this scope.
      const liveBodyA = liveA.body as LiveBody;
      // Capture live body all for use in this scope.
      const liveBodyAll = liveAll.body as LiveBody;
      // Capture attention a for use in this scope.
      const attentionA = liveBodyA.needsAttention ?? [];
      // Capture attention all for use in this scope.
      const attentionAll = liveBodyAll.needsAttention ?? [];
      // Capture ids a for use in this scope.
      const idsA = attentionA.map((r) => r.id);
      // Capture ids all for use in this scope.
      const idsAll = attentionAll.map((r) => r.id);

      // Run next step: assert.ok(
      assert.ok(
        // Run next step: idsA.includes(fx.ticketAId),
        idsA.includes(fx.ticketAId),
        // Run next step: `live A missing ticketA ${fx.ticketAId}; ids=${idsA.join(","…
        `live A missing ticketA ${fx.ticketAId}; ids=${idsA.join(",")}`,
      );
      // Run next step: assert.equal(idsA.includes(fx.ticketBId), false);
      assert.equal(idsA.includes(fx.ticketBId), false);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: attentionA.some((r) => r.location?.id === fx.locBId),
        attentionA.some((r) => r.location?.id === fx.locBId),
        // Run next step: false,
        false,
        // Run next step: "live A must not list locB in needsAttention",
        "live A must not list locB in needsAttention",
      );
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: idsAll.includes(fx.ticketAId) && idsAll.includes(fx.ticketBI…
        idsAll.includes(fx.ticketAId) && idsAll.includes(fx.ticketBId),
        // Run next step: `live all missing tickets; ids=${idsAll.join(",")}`,
        `live all missing tickets; ids=${idsAll.join(",")}`,
      );
      // Deltas vs shared-DB baseline (not absolute totals).
      assert.equal(
        // Run next step: (liveBodyA.counts?.blockingTickets ?? 0) -
        (liveBodyA.counts?.blockingTickets ?? 0) -
          // Run next step: (liveBeforeA.counts?.blockingTickets ?? 0),
          (liveBeforeA.counts?.blockingTickets ?? 0),
        // Run next step: 1,
        1,
        // Run next step: "supervisor A blockingTickets delta",
        "supervisor A blockingTickets delta",
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (liveBodyAll.counts?.blockingTickets ?? 0) -
        (liveBodyAll.counts?.blockingTickets ?? 0) -
          // Run next step: (liveBeforeAll.counts?.blockingTickets ?? 0),
          (liveBeforeAll.counts?.blockingTickets ?? 0),
        // Run next step: 2,
        2,
        // Run next step: "manager blockingTickets delta",
        "manager blockingTickets delta",
      );
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: (liveBodyA.counts?.blockingTickets ?? 0) <
        (liveBodyA.counts?.blockingTickets ?? 0) <
          // Run next step: (liveBodyAll.counts?.blockingTickets ?? 0),
          (liveBodyAll.counts?.blockingTickets ?? 0),
      );

      // Load results a asynchronously for the next steps.
      const resultsA = await getJson(
        // Run next step: api,
        api,
        // Run next step: supTok,
        supTok,
        // Run next step: `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pag…
        `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pageSize=100`,
      );
      // Load results all asynchronously for the next steps.
      const resultsAll = await getJson(
        // Run next step: api,
        api,
        // Run next step: mgrTok,
        mgrTok,
        // Run next step: `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pag…
        `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pageSize=100`,
      );
      // Run next step: assert.equal(resultsA.status, 200);
      assert.equal(resultsA.status, 200);
      // Run next step: assert.equal(resultsAll.status, 200);
      assert.equal(resultsAll.status, 200);
      // Capture body a for use in this scope.
      const bodyA = resultsA.body as ResultsBody;
      // Capture body all for use in this scope.
      const bodyAll = resultsAll.body as ResultsBody;
      // Capture summary a for use in this scope.
      const summaryA = bodyA.summary;
      // Capture summary all for use in this scope.
      const summaryAll = bodyAll.summary;
      // Run next step: assert.ok(summaryA && summaryAll);
      assert.ok(summaryA && summaryAll);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (summaryA.completedTasks ?? 0) -
        (summaryA.completedTasks ?? 0) -
          // Run next step: (resultsBeforeA.summary?.completedTasks ?? 0),
          (resultsBeforeA.summary?.completedTasks ?? 0),
        // Run next step: 1,
        1,
        // Run next step: "results completedTasks delta A",
        "results completedTasks delta A",
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (summaryAll.completedTasks ?? 0) -
        (summaryAll.completedTasks ?? 0) -
          // Run next step: (resultsBeforeAll.summary?.completedTasks ?? 0),
          (resultsBeforeAll.summary?.completedTasks ?? 0),
        // Run next step: 2,
        2,
        // Run next step: "results completedTasks delta all",
        "results completedTasks delta all",
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (summaryA.completedSessions ?? 0) -
        (summaryA.completedSessions ?? 0) -
          // Run next step: (resultsBeforeA.summary?.completedSessions ?? 0),
          (resultsBeforeA.summary?.completedSessions ?? 0),
        // Run next step: 1,
        1,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (summaryAll.completedSessions ?? 0) -
        (summaryAll.completedSessions ?? 0) -
          // Run next step: (resultsBeforeAll.summary?.completedSessions ?? 0),
          (resultsBeforeAll.summary?.completedSessions ?? 0),
        // Run next step: 2,
        2,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (summaryA.distinctRooms ?? 0) -
        (summaryA.distinctRooms ?? 0) -
          // Run next step: (resultsBeforeA.summary?.distinctRooms ?? 0),
          (resultsBeforeA.summary?.distinctRooms ?? 0),
        // Run next step: 1,
        1,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (summaryAll.distinctRooms ?? 0) -
        (summaryAll.distinctRooms ?? 0) -
          // Run next step: (resultsBeforeAll.summary?.distinctRooms ?? 0),
          (resultsBeforeAll.summary?.distinctRooms ?? 0),
        // Run next step: 2,
        2,
      );
      // Define rowEmpIdsA as a callable used by this flow.
      const rowEmpIdsA = (bodyA.rows ?? []).map((r) => r.employeeId);
      // Run next step: assert.ok(rowEmpIdsA.includes(fx.housekeeper.employeeId));
      assert.ok(rowEmpIdsA.includes(fx.housekeeper.employeeId));
      // Run next step: assert.equal(rowEmpIdsA.includes(fx.otherHk.employeeId), fal…
      assert.equal(rowEmpIdsA.includes(fx.otherHk.employeeId), false);
      // Define rowEmpIdsAll as a callable used by this flow.
      const rowEmpIdsAll = (bodyAll.rows ?? []).map((r) => r.employeeId);
      // Run next step: assert.ok(rowEmpIdsAll.includes(fx.housekeeper.employeeId));
      assert.ok(rowEmpIdsAll.includes(fx.housekeeper.employeeId));
      // Run next step: assert.ok(rowEmpIdsAll.includes(fx.otherHk.employeeId));
      assert.ok(rowEmpIdsAll.includes(fx.otherHk.employeeId));

      // Load analytics a asynchronously for the next steps.
      const analyticsA = await getJson(
        // Run next step: api,
        api,
        // Run next step: supTok,
        supTok,
        // Run next step: `/analytics/summary?domain=housekeeping&from=${seed.fromIso}…
        `/analytics/summary?domain=housekeeping&from=${seed.fromIso}&to=${seed.toIso}`,
      );
      // Load analytics all asynchronously for the next steps.
      const analyticsAll = await getJson(
        // Run next step: api,
        api,
        // Run next step: mgrTok,
        mgrTok,
        // Run next step: `/analytics/summary?domain=housekeeping&from=${seed.fromIso}…
        `/analytics/summary?domain=housekeeping&from=${seed.fromIso}&to=${seed.toIso}`,
      );
      // Run next step: assert.equal(analyticsA.status, 200);
      assert.equal(analyticsA.status, 200);
      // Run next step: assert.equal(analyticsAll.status, 200);
      assert.equal(analyticsAll.status, 200);
      // Define kpisA as a callable used by this flow.
      const kpisA = (analyticsA.body as { kpis?: AnalyticsKpis }).kpis;
      // Define kpisAll as a callable used by this flow.
      const kpisAll = (analyticsAll.body as { kpis?: AnalyticsKpis }).kpis;
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (kpisA?.cleanedTasks ?? 0) -
        (kpisA?.cleanedTasks ?? 0) -
          // Run next step: (analyticsBeforeA.kpis?.cleanedTasks ?? 0),
          (analyticsBeforeA.kpis?.cleanedTasks ?? 0),
        // Run next step: 1,
        1,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (kpisAll?.cleanedTasks ?? 0) -
        (kpisAll?.cleanedTasks ?? 0) -
          // Run next step: (analyticsBeforeAll.kpis?.cleanedTasks ?? 0),
          (analyticsBeforeAll.kpis?.cleanedTasks ?? 0),
        // Run next step: 2,
        2,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (kpisA?.completedSessions ?? 0) -
        (kpisA?.completedSessions ?? 0) -
          // Run next step: (analyticsBeforeA.kpis?.completedSessions ?? 0),
          (analyticsBeforeA.kpis?.completedSessions ?? 0),
        // Run next step: 1,
        1,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (kpisAll?.completedSessions ?? 0) -
        (kpisAll?.completedSessions ?? 0) -
          // Run next step: (analyticsBeforeAll.kpis?.completedSessions ?? 0),
          (analyticsBeforeAll.kpis?.completedSessions ?? 0),
        // Run next step: 2,
        2,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (kpisA?.distinctRooms ?? 0) -
        (kpisA?.distinctRooms ?? 0) -
          // Run next step: (analyticsBeforeA.kpis?.distinctRooms ?? 0),
          (analyticsBeforeA.kpis?.distinctRooms ?? 0),
        // Run next step: 1,
        1,
      );
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: (kpisAll?.distinctRooms ?? 0) -
        (kpisAll?.distinctRooms ?? 0) -
          // Run next step: (analyticsBeforeAll.kpis?.distinctRooms ?? 0),
          (analyticsBeforeAll.kpis?.distinctRooms ?? 0),
        // Run next step: 2,
        2,
      );
    // Run next step: } finally {
    } finally {
      // Branch when this condition holds so the right path runs.
      if (seed) await cleanupAggregateSeed(prisma, seed);
    }
  });

  // Run next step: it("foreign maintenance history and live work cannot change …
  it("foreign maintenance history and live work cannot change any scoped counter", async () => {
    // Load sup asynchronously for the next steps.
    const sup = await loginBearer(api, fx.supervisorA.email, fx.password);
    // Load manager asynchronously for the next steps.
    const manager = await loginBearer(api, fx.manager.email, fx.password);
    // Capture url for use in this scope.
    const url = "/analytics/summary?domain=maintenance&from=2099-07-10&to=2099-07-10";
    // Define analytics as a callable used by this flow.
    const analytics = async (token: string) => {
      // Load result asynchronously for the next steps.
      const result = await getJson(api, token, url);
      // Run next step: assert.equal(result.status, 200);
      assert.equal(result.status, 200);
      // Return the computed result to the caller.
      return result.body as {
        // Set kpis on the structure being built.
        kpis: { signals: number; slaBreaches: { active: number; closed: number }; reopened: number; durationSampleCount: number };
        // Set comparison on the structure being built.
        comparison: { signals: { previous: number }; reopened: { previous: number } };
        // Set series on the structure being built.
        series: Array<{ count: number }>;
        // Set breakdowns on the structure being built.
        breakdowns: { byCategory: Array<{ key: string; count: number }>; byPriority: Array<{ key: string; count: number }> };
        // Set riskRooms on the structure being built.
        riskRooms: Array<{ locationId: string; ticketCount: number; factors: string[] }>;
        // Set forecast on the structure being built.
        forecast: { dailyRate: number; formula: string };
      };
    };
    // Define live as a callable used by this flow.
    const live = async (token: string) => {
      // Load result asynchronously for the next steps.
      const result = await getJson(api, token, "/operations/live");
      // Run next step: assert.equal(result.status, 200);
      assert.equal(result.status, 200);
      // Capture body for use in this scope.
      const body = result.body as { updatedAt?: string; counts: { active: number; overdue: number;
        // Set anomalies on the structure being built.
        anomalies: number; awaitingInspection: number; blockingTickets: number } };
      // Run next step: delete body.updatedAt;
      delete body.updatedAt;
      // Return the computed result to the caller.
      return body;
    };
    // Load before a asynchronously for the next steps.
    const beforeA = await analytics(sup.token);
    // Load before all asynchronously for the next steps.
    const beforeAll = await analytics(manager.token);
    // Capture today for use in this scope.
    const today = new Date().toISOString().slice(0, 10);
    // Define housekeeping as a callable used by this flow.
    const housekeeping = async (token: string) => {
      // Load response asynchronously for the next steps.
      const response = await getJson(api, token, `/analytics/summary?domain=housekeeping&from=${today}&to=${today}`);
      // Run next step: assert.equal(response.status, 200);
      assert.equal(response.status, 200);
      // Return the computed result to the caller.
      return response.body as { kpis: { cleanedTasks: number; completedSessions: number;
        // Set acceptedTasks on the structure being built.
        acceptedTasks: number; reworkEvents: number; anomalousSessions: number; durationSampleCount: number } };
    };
    // Load before housekeeping a asynchronously for the next steps.
    const beforeHousekeepingA = await housekeeping(sup.token);
    // Load before housekeeping all asynchronously for the next steps.
    const beforeHousekeepingAll = await housekeeping(manager.token);
    // Load before live a asynchronously for the next steps.
    const beforeLiveA = await live(sup.token);
    // Load before live all asynchronously for the next steps.
    const beforeLiveAll = await live(manager.token);
    // Capture ticket ids for use in this scope.
    const ticketIds: string[] = [];
    // Capture session ids for use in this scope.
    const sessionIds: string[] = [];
    // Capture extra task ids for use in this scope.
    const extraTaskIds: string[] = [];
    // Attempt the fallible work so errors can be handled below.
    try {
      // Capture period for use in this scope.
      const period = new Date("2099-07-10T01:00:00.000Z");
      // Capture prior for use in this scope.
      const prior = new Date("2099-07-09T01:00:00.000Z");
      // Iterate items to apply the same logic to each entry.
      for (const [index, status] of (["new", "waiting", "resolved", "closed", "closed", "closed", "closed"] as const).entries()) {
        // Capture current for use in this scope.
        const current = index < 4;
        // Capture opened at for use in this scope.
        const openedAt = current ? period : index < 6 ? prior : new Date(Date.now() - 60_000);
        // Capture terminal for use in this scope.
        const terminal = status === "resolved" || status === "closed";
        // Load row asynchronously for the next steps.
        const row = await prisma.maintenanceTicket.create({ data: {
          // Set locationId on the structure being built.
          locationId: fx.locBId, title: `FOREIGN-AGG-${index}`, categoryKey: "foreign_scope_probe",
          // Set categoryLabelBg on the structure being built.
          categoryLabelBg: "Чужд", categoryLabelEn: "Foreign", reportedByEmployeeId: fx.supervisorB.employeeId,
          // Run next step: openedAt, status, priority: "urgent", dueAt: new Date("2000-…
          openedAt, status, priority: "urgent", dueAt: new Date("2000-01-01T00:00:00Z"),
          // Set blocksRoom on the structure being built.
          blocksRoom: index === 0, resolvedAt: terminal ? new Date(openedAt.getTime() + 60 * 60_000) : null,
        // Run next step: } });
        } });
        // Append an entry to the accumulating collection.
        ticketIds.push(row.id);
      }
      // Wait for the async step before continuing.
      await prisma.ticketReopenEvent.createMany({ data: [
        // Run next step: { ticketId: ticketIds[0], reopenedAt: period, reopenedByEmpl…
        { ticketId: ticketIds[0], reopenedAt: period, reopenedByEmployeeId: fx.supervisorB.employeeId, previousStatus: "closed" },
        // Run next step: { ticketId: ticketIds[4], reopenedAt: prior, reopenedByEmplo…
        { ticketId: ticketIds[4], reopenedAt: prior, reopenedByEmployeeId: fx.supervisorB.employeeId, previousStatus: "closed" },
      // Run next step: ] });
      ] });
      // Capture old for use in this scope.
      const old = new Date(Date.now() - 24 * 60 * 60_000);
      // Load running asynchronously for the next steps.
      const running = await prisma.cleaningSession.create({ data: { taskId: fx.taskBId,
        // Set employeeId on the structure being built.
        employeeId: fx.otherHk.employeeId, startCommandId: randomUUID(), startedAt: old, status: "running" } });
      // Append an entry to the accumulating collection.
      sessionIds.push(running.id);
      // Load completed task asynchronously for the next steps.
      const completedTask = await prisma.cleaningTask.create({ data: {
        // Set locationId on the structure being built.
        locationId: fx.locBId, sectorId: fx.sectorBId, hotelDate: new Date("2099-07-12"),
        // Set status on the structure being built.
        status: "completed", completedAt: new Date(), dueAt: old, priority: "urgent",
        // Set serviceType on the structure being built.
        serviceType: "arrival", assignedEmployeeId: fx.otherHk.employeeId,
      // Run next step: } });
      } });
      // Append an entry to the accumulating collection.
      extraTaskIds.push(completedTask.id);
      // Load completed asynchronously for the next steps.
      const completed = await prisma.cleaningSession.create({ data: { taskId: completedTask.id,
        // Set employeeId on the structure being built.
        employeeId: fx.otherHk.employeeId, startCommandId: randomUUID(), startedAt: old, finishedAt: new Date(), status: "completed" } });
      // Append an entry to the accumulating collection.
      sessionIds.push(completed.id);
      // Load valid asynchronously for the next steps.
      const valid = await prisma.cleaningSession.create({ data: { taskId: completedTask.id,
        // Set employeeId on the structure being built.
        employeeId: fx.otherHk.employeeId, startCommandId: randomUUID(),
        // Set startedAt on the structure being built.
        startedAt: new Date(Date.now() - 20 * 60_000), finishedAt: new Date(), status: "completed" } });
      // Append an entry to the accumulating collection.
      sessionIds.push(valid.id);
      // Wait for the async step before continuing.
      await prisma.inspection.createMany({ data: (["approved", "rejected"] as const).map((result) => ({
        // Set taskId on the structure being built.
        taskId: completedTask.id, inspectorEmployeeId: fx.supervisorB.employeeId,
        // Set commandId on the structure being built.
        commandId: randomUUID(), result, findings: "foreign inspection", inspectedAt: new Date(),
      // Run next step: })) });
      })) });
      // Load awaiting asynchronously for the next steps.
      const awaiting = await prisma.cleaningTask.create({ data: { locationId: fx.locBId,
        // Set sectorId on the structure being built.
        sectorId: fx.sectorBId, hotelDate: new Date("2099-07-11"), status: "awaiting_inspection",
        // Set assignedEmployeeId on the structure being built.
        assignedEmployeeId: fx.otherHk.employeeId } });
      // Append an entry to the accumulating collection.
      extraTaskIds.push(awaiting.id);

      // Load after a asynchronously for the next steps.
      const afterA = await analytics(sup.token);
      // Run next step: assert.deepEqual(afterA, beforeA, "foreign rows cannot alter…
      assert.deepEqual(afterA, beforeA, "foreign rows cannot alter KPIs, comparisons, series, breakdowns, risks or forecast");
      // Run next step: assert.deepEqual(await housekeeping(sup.token), beforeHousek…
      assert.deepEqual(await housekeeping(sup.token), beforeHousekeepingA,
        // Run next step: "foreign task/session/inspection/risk rows cannot alter any …
        "foreign task/session/inspection/risk rows cannot alter any housekeeping counter or chart");
      // Load after housekeeping all asynchronously for the next steps.
      const afterHousekeepingAll = await housekeeping(manager.token);
      // Iterate items to apply the same logic to each entry.
      for (const counter of ["cleanedTasks", "acceptedTasks", "reworkEvents", "anomalousSessions", "durationSampleCount"] as const) {
        // Run next step: assert.equal(afterHousekeepingAll.kpis[counter] - beforeHous…
        assert.equal(afterHousekeepingAll.kpis[counter] - beforeHousekeepingAll.kpis[counter], 1, counter);
      }
      // Run next step: assert.equal(afterHousekeepingAll.kpis.completedSessions - b…
      assert.equal(afterHousekeepingAll.kpis.completedSessions - beforeHousekeepingAll.kpis.completedSessions, 2);
      // Run next step: assert.deepEqual(await live(sup.token), beforeLiveA, "foreig…
      assert.deepEqual(await live(sup.token), beforeLiveA, "foreign work cannot alter any live list or counter");
      // Load after all asynchronously for the next steps.
      const afterAll = await analytics(manager.token);
      // Run next step: assert.equal(afterAll.kpis.signals - beforeAll.kpis.signals,…
      assert.equal(afterAll.kpis.signals - beforeAll.kpis.signals, 4);
      // Run next step: assert.equal(afterAll.kpis.slaBreaches.active - beforeAll.kp…
      assert.equal(afterAll.kpis.slaBreaches.active - beforeAll.kpis.slaBreaches.active, 2);
      // Run next step: assert.equal(afterAll.kpis.slaBreaches.closed - beforeAll.kp…
      assert.equal(afterAll.kpis.slaBreaches.closed - beforeAll.kpis.slaBreaches.closed, 2);
      // Run next step: assert.equal(afterAll.kpis.reopened - beforeAll.kpis.reopene…
      assert.equal(afterAll.kpis.reopened - beforeAll.kpis.reopened, 1);
      // Run next step: assert.equal(afterAll.kpis.durationSampleCount - beforeAll.k…
      assert.equal(afterAll.kpis.durationSampleCount - beforeAll.kpis.durationSampleCount, 2);
      // Run next step: assert.equal(afterAll.comparison.signals.previous - beforeAl…
      assert.equal(afterAll.comparison.signals.previous - beforeAll.comparison.signals.previous, 2);
      // Run next step: assert.equal(afterAll.comparison.reopened.previous - beforeA…
      assert.equal(afterAll.comparison.reopened.previous - beforeAll.comparison.reopened.previous, 1);
      // Run next step: assert.equal(afterAll.series.reduce((sum, row) => sum + row.…
      assert.equal(afterAll.series.reduce((sum, row) => sum + row.count, 0) - beforeAll.series.reduce((sum, row) => sum + row.count, 0), 4);
      // Run next step: assert.equal(afterAll.breakdowns.byCategory.find((row) => ro…
      assert.equal(afterAll.breakdowns.byCategory.find((row) => row.key === "foreign_scope_probe")?.count, 4);
      // Run next step: assert.equal(afterAll.breakdowns.byPriority.find((row) => ro…
      assert.equal(afterAll.breakdowns.byPriority.find((row) => row.key === "urgent")!.count - (beforeAll.breakdowns.byPriority.find((row) => row.key === "urgent")?.count ?? 0), 4);
      // Capture risk for use in this scope.
      const risk = afterAll.riskRooms.find((row) => row.locationId === fx.locBId);
      // Run next step: assert.ok(risk?.factors.includes("blocking_past_sla"));
      assert.ok(risk?.factors.includes("blocking_past_sla"));
      // Run next step: assert.equal(risk?.ticketCount, 4);
      assert.equal(risk?.ticketCount, 4);
      // Run next step: assert.notEqual(afterAll.forecast.formula, beforeAll.forecas…
      assert.notEqual(afterAll.forecast.formula, beforeAll.forecast.formula, "forecast positive control sees the current foreign ticket");
      // Load after live all asynchronously for the next steps.
      const afterLiveAll = await live(manager.token);
      // Iterate items to apply the same logic to each entry.
      for (const counter of ["active", "overdue", "anomalies", "awaitingInspection", "blockingTickets"] as const) {
        // Run next step: assert.equal(afterLiveAll.counts[counter] - beforeLiveAll.co…
        assert.equal(afterLiveAll.counts[counter] - beforeLiveAll.counts[counter], 1, counter);
      }
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await prisma.cleaningSession.deleteMany({ where: { id: { in: sessionIds } } });
      // Wait for the async step before continuing.
      await prisma.inspection.deleteMany({ where: { taskId: { in: extraTaskIds } } });
      // Wait for the async step before continuing.
      await prisma.cleaningTask.deleteMany({ where: { id: { in: extraTaskIds } } });
      // Wait for the async step before continuing.
      await prisma.ticketReopenEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
      // Wait for the async step before continuing.
      await prisma.maintenanceTicket.deleteMany({ where: { id: { in: ticketIds } } });
    }
  });
});
