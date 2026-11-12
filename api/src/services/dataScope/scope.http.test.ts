/**
 * HTTP integration:
 * 02, .
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupAggregateSeed,
  cleanupEmployeeGraph,
  cleanupScopeSmokeFixture,
  createEmployeeWithUser,
  createScopeSmokeFixture,
  seedScopeAggregateExtras,
  // Declare type AggregateSeedIds for callers and internals.
  type AggregateSeedIds,
  // Declare type EmployeeUserFixture for callers and internals.
  type EmployeeUserFixture,
  // Declare type ScopeSmokeFixture for callers and internals.
  type ScopeSmokeFixture,
} from "../../../tests/fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  patchJson,
  postJson,
  putJson,
  putRoleGrantsJson,
  restoreRoleGrants,
  snapshotRoleGrants,
  // Declare type RoleGrantSnapshotRow for callers and internals.
  type RoleGrantSnapshotRow,
} from "../../../tests/httpHarness";
import {
  ensureDefaultRoleGrants,
  getGrantsForRole,
  invalidateGrantCache,
} from "../roleGrants";

dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-scope-http";

const prisma = new PrismaClient();
// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

function assertOutOfScope(res: { status: number; body: unknown }, label: string) {
  assert.equal(res.status, 403, `${label} → ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal((res.body as { error?: string }).error, "forbidden");
  assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
}

describe("dataScope HTTP", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";
  let fx: ScopeSmokeFixture;
  let technician: EmployeeUserFixture;
  let owner: EmployeeUserFixture;
  // Capture grant snap for use in this scope.
  let grantSnap: RoleGrantSnapshotRow[] = [];

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    invalidateGrantCache();
    // Update grant snap as control flow progresses.
    grantSnap = await snapshotRoleGrants(prisma, [
      Role.supervisor,
      Role.manager,
      Role.admin,
    ]);

    fx = await createScopeSmokeFixture(prisma);
    const stamp = Date.now();
    technician = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-SCOPE-TECH-${stamp}`,
      email: `t-scope-tech-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T Scope Tech",
    });
    owner = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-SCOPE-OWN-${stamp}`,
      email: `t-scope-own-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Scope Owner",
    });

    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  after(async () => {
    await restoreRoleGrants(
      prisma,
      [Role.supervisor, Role.manager, Role.admin],
      grantSnap,
    );
    if (server) await closeServer(server);
    await cleanupEmployeeGraph(prisma, [
      technician.employeeId,
      owner.employeeId,
    ]);
    await cleanupScopeSmokeFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it("OOS location mutations denied", async () => {
    const { token } = await loginBearer(
      api,
      fx.supervisorA.email,
      fx.password,
    );
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: fx.locBId },
    });

    assertOutOfScope(
      await postJson(api, token, `/rooms/${fx.locBId}/mark-dirty`, {}),
      "mark-dirty",
    );
    assertOutOfScope(
      await patchJson(api, token, `/locations/${fx.locBId}/occupancy`, {
        occupancy: "vacant",
      }),
      "occupancy",
    );
    assertOutOfScope(
      await patchJson(api, token, `/locations/${fx.locBId}/service-status`, {
        serviceStatus: "in_service",
      }),
      "service-status",
    );
    assertOutOfScope(
      await postJson(api, token, `/locations/${fx.locBId}/archive`, {}),
      "archive",
    );
    assertOutOfScope(
      await patchJson(api, token, `/locations/${fx.locBId}`, {
        number: "OOS-SHOULD-FAIL",
      }),
      "catalog update",
    );

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: fx.locBId },
    });
    assert.equal(after.occupancy, loc.occupancy);
    assert.equal(after.serviceStatus, loc.serviceStatus);
    assert.equal(after.catalogStatus, loc.catalogStatus);
    assert.equal(after.cleaningStatus, loc.cleaningStatus);
    assert.equal(after.number, loc.number);
  });

  it("OOS GET detail has no cleaningStatus side effects", async () => {
    const { token } = await loginBearer(
      api,
      fx.supervisorA.email,
      fx.password,
    );
    const original = await prisma.location.findUniqueOrThrow({
      where: { id: fx.locBId },
      select: { cleaningStatus: true },
    });
    // Seed an orphan status that a GET-side reconcile would previously "heal".
    await prisma.location.update({
      where: { id: fx.locBId },
      data: { cleaningStatus: "in_progress" },
    });

    assertOutOfScope(
      await getJson(api, token, `/rooms/${fx.locBId}`),
      "GET room detail",
    );

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: fx.locBId },
      select: { cleaningStatus: true },
    });
    assert.equal(
      after.cleaningStatus,
      "in_progress",
      "OOS GET must not mutate cleaningStatus",
    );

    // Restore fixture status for later tests.
    await prisma.location.update({
      where: { id: fx.locBId },
      data: { cleaningStatus: original.cleaningStatus },
    });
  });

  it("OOS ticket lifecycle denied", async () => {
    const { token } = await loginBearer(
      api,
      fx.supervisorA.email,
      fx.password,
    );
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: fx.ticketBId },
    });

    const routes: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: `/maintenance/tickets/${fx.ticketBId}/assign`,
        body: { assigneeId: technician.employeeId },
      },
      { path: `/maintenance/tickets/${fx.ticketBId}/start`, body: {} },
      { path: `/maintenance/tickets/${fx.ticketBId}/wait`, body: {} },
      { path: `/maintenance/tickets/${fx.ticketBId}/resume`, body: {} },
      { path: `/maintenance/tickets/${fx.ticketBId}/resolve`, body: {} },
      { path: `/maintenance/tickets/${fx.ticketBId}/close`, body: {} },
      { path: `/maintenance/tickets/${fx.ticketBId}/reopen`, body: {} },
    ];

    // Iterate items to apply the same logic to each entry.
    for (const r of routes) {
      assertOutOfScope(
        await postJson(api, token, r.path, r.body),
        r.path,
      );
    }

    const after = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: fx.ticketBId },
    });
    assert.equal(after.status, before.status);
    assert.equal(after.assigneeId, before.assigneeId);
  });

  it("omit/swap locationId for location-only audit", async () => {
    // Load local snap asynchronously for the next steps.
    const localSnap = await snapshotRoleGrants(prisma, [Role.supervisor]);
    try {
      const g = await getGrantsForRole(Role.supervisor);
      // Ensure location-only audit: operations.view_live, no full-audit actions.
      const { token: ownerTok } = await loginBearer(
        api,
        owner.email,
        "test-password-t03",
      );
      const actions = g.actions.filter(
        (a) =>
          a !== "audit.view" &&
          a !== "settings.manage" &&
          a !== "permissions.manage",
      );
      if (!actions.includes("operations.view_live")) {
        // Append an entry to the accumulating collection.
        actions.push("operations.view_live");
      }
      const put = await putRoleGrantsJson(api, ownerTok, "supervisor", {
        panels: g.panels,
        actions,
      });
      assert.equal(put.status, 200);

      const { token } = await loginBearer(
        api,
        fx.supervisorA.email,
        fx.password,
      );

      const omit = await getJson(api, token, "/audit");
      assert.equal(omit.status, 403);
      assert.equal(
        (omit.body as { message?: string }).message,
        "Insufficient permissions",
      );

      const own = await getJson(
        api,
        token,
        `/audit?locationId=${encodeURIComponent(fx.locAId)}`,
      );
      assert.equal(own.status, 200);
      assert.ok(Array.isArray(own.body));
      const ids = (own.body as Array<{ id: string }>).map((e) => e.id);
      assert.ok(ids.includes(fx.auditOwnId));
      assert.equal(ids.includes(fx.auditForeignId), false);

      assertOutOfScope(
        await getJson(
          api,
          token,
          `/audit?locationId=${encodeURIComponent(fx.locBId)}`,
        ),
        "audit foreign location",
      );
    } finally {
      await restoreRoleGrants(prisma, [Role.supervisor], localSnap);
    }
  });

  it("sector deactivate refreshes next read/action", async () => {
    const { token: mgrTok } = await loginBearer(
      api,
      fx.manager.email,
      fx.password,
    );
    const { token: supTok } = await loginBearer(
      api,
      fx.supervisorA.email,
      fx.password,
    );

    // Load rooms before asynchronously for the next steps.
    const roomsBefore = await getJson(api, supTok, "/rooms");
    assert.equal(roomsBefore.status, 200);
    const idsBefore = (roomsBefore.body as Array<{ id: string }>).map(
      (r) => r.id,
    );
    assert.ok(idsBefore.includes(fx.locAId));

    // Load sector get asynchronously for the next steps.
    const sectorGet = await getJson(api, mgrTok, `/sectors/${fx.sectorAId}`);
    assert.equal(sectorGet.status, 200);
    let version = (sectorGet.body as { version: number }).version;

    const deact = await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
      isActive: false,
      expectedVersion: version,
    });
    assert.equal(deact.status, 200, JSON.stringify(deact.body));
    version = (deact.body as { version: number }).version;

    try {
      // Load rooms after asynchronously for the next steps.
      const roomsAfter = await getJson(api, supTok, "/rooms");
      assert.equal(roomsAfter.status, 200);
      const idsAfter = (roomsAfter.body as Array<{ id: string }>).map(
        (r) => r.id,
      );
      assert.equal(idsAfter.includes(fx.locAId), false);

      assertOutOfScope(
        await postJson(api, supTok, `/rooms/${fx.locAId}/mark-dirty`, {}),
        "mark-dirty after deactivate",
      );
    } finally {
      await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
        isActive: true,
        expectedVersion: version,
      });
    }
  });

  it("primarySupervisor reassignment refreshes next read/action", async () => {
    const { token: mgrTok } = await loginBearer(
      api,
      fx.manager.email,
      fx.password,
    );
    const { token: supTok } = await loginBearer(
      api,
      fx.supervisorA.email,
      fx.password,
    );

    // Load rooms before asynchronously for the next steps.
    const roomsBefore = await getJson(api, supTok, "/rooms");
    assert.equal(roomsBefore.status, 200);
    const idsBefore = (roomsBefore.body as Array<{ id: string }>).map(
      (r) => r.id,
    );
    assert.ok(idsBefore.includes(fx.locAId));

    // Load sector get asynchronously for the next steps.
    const sectorGet = await getJson(api, mgrTok, `/sectors/${fx.sectorAId}`);
    assert.equal(sectorGet.status, 200);
    let version = (sectorGet.body as { version: number }).version;

    const reassign = await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
      primarySupervisorEmployeeId: fx.supervisorB.employeeId,
      expectedVersion: version,
    });
    assert.equal(reassign.status, 200, JSON.stringify(reassign.body));
    version = (reassign.body as { version: number }).version;

    try {
      // Load rooms after asynchronously for the next steps.
      const roomsAfter = await getJson(api, supTok, "/rooms");
      assert.equal(roomsAfter.status, 200);
      const idsAfter = (roomsAfter.body as Array<{ id: string }>).map(
        (r) => r.id,
      );
      assert.equal(idsAfter.includes(fx.locAId), false);

      assertOutOfScope(
        await postJson(api, supTok, `/rooms/${fx.locAId}/mark-dirty`, {}),
        "mark-dirty after supervisor reassignment",
      );
    } finally {
      await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
        primarySupervisorEmployeeId: fx.supervisorA.employeeId,
        expectedVersion: version,
      });
    }
  });

  it("plan/live/results/analytics scoped aggregates", async () => {
    let seed: AggregateSeedIds | null = null;
    try {
      const { token: supTok } = await loginBearer(
        api,
        fx.supervisorA.email,
        fx.password,
      );
      const { token: mgrTok } = await loginBearer(
        api,
        fx.manager.email,
        fx.password,
      );

      // Shared DB may already hold seed tickets/tasks — assert deltas + fixture ids.
      const hotelDateYmd = fx.hotelDate.toISOString().slice(0, 10);
      // Declare type LiveBody for callers and internals.
      type LiveBody = {
        needsAttention?: Array<{
          kind?: string;
          id?: string;
          location?: { id?: string };
        }>;
        counts?: { blockingTickets?: number };
      };
      // Declare type ResultsBody for callers and internals.
      type ResultsBody = {
        summary?: {
          completedTasks?: number;
          distinctRooms?: number;
          completedSessions?: number;
        };
        rows?: Array<{ employeeId?: string; completedTasks?: number }>;
      };
      // Declare type AnalyticsKpis for callers and internals.
      type AnalyticsKpis = {
        cleanedTasks?: number;
        completedSessions?: number;
        distinctRooms?: number;
      };

      const liveBeforeA = (await getJson(api, supTok, "/operations/live"))
        // Continue the chained call from the previous expression.
        .body as LiveBody;
      const liveBeforeAll = (await getJson(api, mgrTok, "/operations/live"))
        // Continue the chained call from the previous expression.
        .body as LiveBody;
      const resultsBeforeA = (
        await getJson(
          api,
          supTok,
          `/cleaning/results?from=${hotelDateYmd}&to=${hotelDateYmd}&pageSize=100`,
        )
      ).body as ResultsBody;
      const resultsBeforeAll = (
        await getJson(
          api,
          mgrTok,
          `/cleaning/results?from=${hotelDateYmd}&to=${hotelDateYmd}&pageSize=100`,
        )
      ).body as ResultsBody;
      const analyticsBeforeA = (
        await getJson(
          api,
          supTok,
          `/analytics/summary?domain=housekeeping&from=${hotelDateYmd}&to=${hotelDateYmd}`,
        )
      ).body as { kpis?: AnalyticsKpis };
      const analyticsBeforeAll = (
        await getJson(
          api,
          mgrTok,
          `/analytics/summary?domain=housekeeping&from=${hotelDateYmd}&to=${hotelDateYmd}`,
        )
      ).body as { kpis?: AnalyticsKpis };

      seed = await seedScopeAggregateExtras(prisma, fx);

      // Load plan a asynchronously for the next steps.
      const planA = await getJson(
        api,
        supTok,
        `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
      );
      // Load plan all asynchronously for the next steps.
      const planAll = await getJson(
        api,
        mgrTok,
        `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
      );
      assert.equal(planA.status, 200);
      assert.equal(planAll.status, 200);
      // Declare type PlanEntry for callers and internals.
      type PlanEntry = { room?: { id?: string } };
      // Collect entries a list for later processing.
      const entriesA = [
        ...((planA.body as { departures?: PlanEntry[] }).departures ?? []),
        ...((planA.body as { arrivals?: PlanEntry[] }).arrivals ?? []),
        ...((planA.body as { priority?: PlanEntry[] }).priority ?? []),
      ];
      // Collect entries all list for later processing.
      const entriesAll = [
        ...((planAll.body as { departures?: PlanEntry[] }).departures ?? []),
        ...((planAll.body as { arrivals?: PlanEntry[] }).arrivals ?? []),
        ...((planAll.body as { priority?: PlanEntry[] }).priority ?? []),
      ];
      assert.ok(
        entriesA.length >= 1,
        `scoped plan empty: ${JSON.stringify(planA.body)}`,
      );
      assert.ok(
        entriesAll.length >= 2,
        `all-scope plan too small: ${JSON.stringify(planAll.body)}`,
      );
      assert.ok(entriesA.every((e) => e.room?.id === fx.locAId));
      assert.equal(
        entriesA.some((e) => e.room?.id === fx.locBId),
        false,
      );
      assert.ok(entriesA.length < entriesAll.length);

      // Make fixture tickets visible on the live board.
      await prisma.maintenanceTicket.updateMany({
        where: { id: { in: [fx.ticketAId, fx.ticketBId] } },
        data: { blocksRoom: true },
      });

      // Load live a asynchronously for the next steps.
      const liveA = await getJson(api, supTok, "/operations/live");
      // Load live all asynchronously for the next steps.
      const liveAll = await getJson(api, mgrTok, "/operations/live");
      assert.equal(liveA.status, 200);
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

      assert.ok(
        idsA.includes(fx.ticketAId),
        `live A missing ticketA ${fx.ticketAId}; ids=${idsA.join(",")}`,
      );
      assert.equal(idsA.includes(fx.ticketBId), false);
      assert.equal(
        attentionA.some((r) => r.location?.id === fx.locBId),
        false,
        "live A must not list locB in needsAttention",
      );
      assert.ok(
        idsAll.includes(fx.ticketAId) && idsAll.includes(fx.ticketBId),
        `live all missing tickets; ids=${idsAll.join(",")}`,
      );
      // Deltas vs shared-DB baseline (not absolute totals).
      assert.equal(
        (liveBodyA.counts?.blockingTickets ?? 0) -
          (liveBeforeA.counts?.blockingTickets ?? 0),
        1,
        "supervisor A blockingTickets delta",
      );
      assert.equal(
        (liveBodyAll.counts?.blockingTickets ?? 0) -
          (liveBeforeAll.counts?.blockingTickets ?? 0),
        2,
        "manager blockingTickets delta",
      );
      assert.ok(
        (liveBodyA.counts?.blockingTickets ?? 0) <
          (liveBodyAll.counts?.blockingTickets ?? 0),
      );

      // Load results a asynchronously for the next steps.
      const resultsA = await getJson(
        api,
        supTok,
        `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pageSize=100`,
      );
      // Load results all asynchronously for the next steps.
      const resultsAll = await getJson(
        api,
        mgrTok,
        `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pageSize=100`,
      );
      assert.equal(resultsA.status, 200);
      assert.equal(resultsAll.status, 200);
      // Capture body a for use in this scope.
      const bodyA = resultsA.body as ResultsBody;
      // Capture body all for use in this scope.
      const bodyAll = resultsAll.body as ResultsBody;
      // Capture summary a for use in this scope.
      const summaryA = bodyA.summary;
      // Capture summary all for use in this scope.
      const summaryAll = bodyAll.summary;
      assert.ok(summaryA && summaryAll);
      assert.equal(
        (summaryA.completedTasks ?? 0) -
          (resultsBeforeA.summary?.completedTasks ?? 0),
        1,
        "results completedTasks delta A",
      );
      assert.equal(
        (summaryAll.completedTasks ?? 0) -
          (resultsBeforeAll.summary?.completedTasks ?? 0),
        2,
        "results completedTasks delta all",
      );
      assert.equal(
        (summaryA.completedSessions ?? 0) -
          (resultsBeforeA.summary?.completedSessions ?? 0),
        1,
      );
      assert.equal(
        (summaryAll.completedSessions ?? 0) -
          (resultsBeforeAll.summary?.completedSessions ?? 0),
        2,
      );
      assert.equal(
        (summaryA.distinctRooms ?? 0) -
          (resultsBeforeA.summary?.distinctRooms ?? 0),
        1,
      );
      assert.equal(
        (summaryAll.distinctRooms ?? 0) -
          (resultsBeforeAll.summary?.distinctRooms ?? 0),
        2,
      );
      const rowEmpIdsA = (bodyA.rows ?? []).map((r) => r.employeeId);
      assert.ok(rowEmpIdsA.includes(fx.housekeeper.employeeId));
      assert.equal(rowEmpIdsA.includes(fx.otherHk.employeeId), false);
      const rowEmpIdsAll = (bodyAll.rows ?? []).map((r) => r.employeeId);
      assert.ok(rowEmpIdsAll.includes(fx.housekeeper.employeeId));
      assert.ok(rowEmpIdsAll.includes(fx.otherHk.employeeId));

      // Load analytics a asynchronously for the next steps.
      const analyticsA = await getJson(
        api,
        supTok,
        `/analytics/summary?domain=housekeeping&from=${seed.fromIso}&to=${seed.toIso}`,
      );
      // Load analytics all asynchronously for the next steps.
      const analyticsAll = await getJson(
        api,
        mgrTok,
        `/analytics/summary?domain=housekeeping&from=${seed.fromIso}&to=${seed.toIso}`,
      );
      assert.equal(analyticsA.status, 200);
      assert.equal(analyticsAll.status, 200);
      const kpisA = (analyticsA.body as { kpis?: AnalyticsKpis }).kpis;
      const kpisAll = (analyticsAll.body as { kpis?: AnalyticsKpis }).kpis;
      assert.equal(
        (kpisA?.cleanedTasks ?? 0) -
          (analyticsBeforeA.kpis?.cleanedTasks ?? 0),
        1,
      );
      assert.equal(
        (kpisAll?.cleanedTasks ?? 0) -
          (analyticsBeforeAll.kpis?.cleanedTasks ?? 0),
        2,
      );
      assert.equal(
        (kpisA?.completedSessions ?? 0) -
          (analyticsBeforeA.kpis?.completedSessions ?? 0),
        1,
      );
      assert.equal(
        (kpisAll?.completedSessions ?? 0) -
          (analyticsBeforeAll.kpis?.completedSessions ?? 0),
        2,
      );
      assert.equal(
        (kpisA?.distinctRooms ?? 0) -
          (analyticsBeforeA.kpis?.distinctRooms ?? 0),
        1,
      );
      assert.equal(
        (kpisAll?.distinctRooms ?? 0) -
          (analyticsBeforeAll.kpis?.distinctRooms ?? 0),
        2,
      );
    } finally {
      if (seed) await cleanupAggregateSeed(prisma, seed);
    }
  });

  it("foreign maintenance history and live work cannot change any scoped counter", async () => {
    const sup = await loginBearer(api, fx.supervisorA.email, fx.password);
    const manager = await loginBearer(api, fx.manager.email, fx.password);
    const url = "/analytics/summary?domain=maintenance&from=2099-07-10&to=2099-07-10";
    const analytics = async (token: string) => {
      const result = await getJson(api, token, url);
      assert.equal(result.status, 200);
      return result.body as {
        kpis: { signals: number; slaBreaches: { active: number; closed: number }; reopened: number; durationSampleCount: number };
        comparison: { signals: { previous: number }; reopened: { previous: number } };
        series: Array<{ count: number }>;
        breakdowns: { byCategory: Array<{ key: string; count: number }>; byPriority: Array<{ key: string; count: number }> };
        riskRooms: Array<{ locationId: string; ticketCount: number; factors: string[] }>;
        forecast: { dailyRate: number; formula: string };
      };
    };
    const live = async (token: string) => {
      const result = await getJson(api, token, "/operations/live");
      assert.equal(result.status, 200);
      const body = result.body as { updatedAt?: string; counts: { active: number; overdue: number;
        anomalies: number; awaitingInspection: number; blockingTickets: number } };
      delete body.updatedAt;
      return body;
    };
    // Load before a asynchronously for the next steps.
    const beforeA = await analytics(sup.token);
    // Load before all asynchronously for the next steps.
    const beforeAll = await analytics(manager.token);
    const today = new Date().toISOString().slice(0, 10);
    const housekeeping = async (token: string) => {
      const response = await getJson(api, token, `/analytics/summary?domain=housekeeping&from=${today}&to=${today}`);
      assert.equal(response.status, 200);
      return response.body as { kpis: { cleanedTasks: number; completedSessions: number;
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
    try {
      const period = new Date("2099-07-10T01:00:00.000Z");
      const prior = new Date("2099-07-09T01:00:00.000Z");
      // Iterate items to apply the same logic to each entry.
      for (const [index, status] of (["new", "waiting", "resolved", "closed", "closed", "closed", "closed"] as const).entries()) {
        const current = index < 4;
        // Capture opened at for use in this scope.
        const openedAt = current ? period : index < 6 ? prior : new Date(Date.now() - 60_000);
        const terminal = status === "resolved" || status === "closed";
        const row = await prisma.maintenanceTicket.create({ data: {
          locationId: fx.locBId, title: `FOREIGN-AGG-${index}`, categoryKey: "foreign_scope_probe",
          categoryLabelBg: "Чужд", categoryLabelEn: "Foreign", reportedByEmployeeId: fx.supervisorB.employeeId,
          openedAt, status, priority: "urgent", dueAt: new Date("2000-01-01T00:00:00Z"),
          blocksRoom: index === 0, resolvedAt: terminal ? new Date(openedAt.getTime() + 60 * 60_000) : null,
        } });
        // Append an entry to the accumulating collection.
        ticketIds.push(row.id);
      }
      await prisma.ticketReopenEvent.createMany({ data: [
        { ticketId: ticketIds[0], reopenedAt: period, reopenedByEmployeeId: fx.supervisorB.employeeId, previousStatus: "closed" },
        { ticketId: ticketIds[4], reopenedAt: prior, reopenedByEmployeeId: fx.supervisorB.employeeId, previousStatus: "closed" },
      ] });
      const old = new Date(Date.now() - 24 * 60 * 60_000);
      const running = await prisma.cleaningSession.create({ data: { taskId: fx.taskBId,
        employeeId: fx.otherHk.employeeId, startCommandId: randomUUID(), startedAt: old, status: "running" } });
      // Append an entry to the accumulating collection.
      sessionIds.push(running.id);
      // Load completed task asynchronously for the next steps.
      const completedTask = await prisma.cleaningTask.create({ data: {
        locationId: fx.locBId, sectorId: fx.sectorBId, hotelDate: new Date("2099-07-12"),
        status: "completed", completedAt: new Date(), dueAt: old, priority: "urgent",
        serviceType: "arrival", assignedEmployeeId: fx.otherHk.employeeId,
      } });
      // Append an entry to the accumulating collection.
      extraTaskIds.push(completedTask.id);
      const completed = await prisma.cleaningSession.create({ data: { taskId: completedTask.id,
        employeeId: fx.otherHk.employeeId, startCommandId: randomUUID(), startedAt: old, finishedAt: new Date(), status: "completed" } });
      // Append an entry to the accumulating collection.
      sessionIds.push(completed.id);
      const valid = await prisma.cleaningSession.create({ data: { taskId: completedTask.id,
        employeeId: fx.otherHk.employeeId, startCommandId: randomUUID(),
        startedAt: new Date(Date.now() - 20 * 60_000), finishedAt: new Date(), status: "completed" } });
      // Append an entry to the accumulating collection.
      sessionIds.push(valid.id);
      await prisma.inspection.createMany({ data: (["approved", "rejected"] as const).map((result) => ({
        taskId: completedTask.id, inspectorEmployeeId: fx.supervisorB.employeeId,
        commandId: randomUUID(), result, findings: "foreign inspection", inspectedAt: new Date(),
      })) });
      const awaiting = await prisma.cleaningTask.create({ data: { locationId: fx.locBId,
        sectorId: fx.sectorBId, hotelDate: new Date("2099-07-11"), status: "awaiting_inspection",
        assignedEmployeeId: fx.otherHk.employeeId } });
      // Append an entry to the accumulating collection.
      extraTaskIds.push(awaiting.id);

      // Load after a asynchronously for the next steps.
      const afterA = await analytics(sup.token);
      assert.deepEqual(afterA, beforeA, "foreign rows cannot alter KPIs, comparisons, series, breakdowns, risks or forecast");
      assert.deepEqual(await housekeeping(sup.token), beforeHousekeepingA,
        "foreign task/session/inspection/risk rows cannot alter any housekeeping counter or chart");
      // Load after housekeeping all asynchronously for the next steps.
      const afterHousekeepingAll = await housekeeping(manager.token);
      // Iterate items to apply the same logic to each entry.
      for (const counter of ["cleanedTasks", "acceptedTasks", "reworkEvents", "anomalousSessions", "durationSampleCount"] as const) {
        assert.equal(afterHousekeepingAll.kpis[counter] - beforeHousekeepingAll.kpis[counter], 1, counter);
      }
      assert.equal(afterHousekeepingAll.kpis.completedSessions - beforeHousekeepingAll.kpis.completedSessions, 2);
      assert.deepEqual(await live(sup.token), beforeLiveA, "foreign work cannot alter any live list or counter");
      // Load after all asynchronously for the next steps.
      const afterAll = await analytics(manager.token);
      assert.equal(afterAll.kpis.signals - beforeAll.kpis.signals, 4);
      assert.equal(afterAll.kpis.slaBreaches.active - beforeAll.kpis.slaBreaches.active, 2);
      assert.equal(afterAll.kpis.slaBreaches.closed - beforeAll.kpis.slaBreaches.closed, 2);
      assert.equal(afterAll.kpis.reopened - beforeAll.kpis.reopened, 1);
      assert.equal(afterAll.kpis.durationSampleCount - beforeAll.kpis.durationSampleCount, 2);
      assert.equal(afterAll.comparison.signals.previous - beforeAll.comparison.signals.previous, 2);
      assert.equal(afterAll.comparison.reopened.previous - beforeAll.comparison.reopened.previous, 1);
      assert.equal(afterAll.series.reduce((sum, row) => sum + row.count, 0) - beforeAll.series.reduce((sum, row) => sum + row.count, 0), 4);
      assert.equal(afterAll.breakdowns.byCategory.find((row) => row.key === "foreign_scope_probe")?.count, 4);
      assert.equal(afterAll.breakdowns.byPriority.find((row) => row.key === "urgent")!.count - (beforeAll.breakdowns.byPriority.find((row) => row.key === "urgent")?.count ?? 0), 4);
      const risk = afterAll.riskRooms.find((row) => row.locationId === fx.locBId);
      assert.ok(risk?.factors.includes("blocking_past_sla"));
      assert.equal(risk?.ticketCount, 4);
      assert.notEqual(afterAll.forecast.formula, beforeAll.forecast.formula, "forecast positive control sees the current foreign ticket");
      // Load after live all asynchronously for the next steps.
      const afterLiveAll = await live(manager.token);
      // Iterate items to apply the same logic to each entry.
      for (const counter of ["active", "overdue", "anomalies", "awaitingInspection", "blockingTickets"] as const) {
        assert.equal(afterLiveAll.counts[counter] - beforeLiveAll.counts[counter], 1, counter);
      }
    } finally {
      await prisma.cleaningSession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.inspection.deleteMany({ where: { taskId: { in: extraTaskIds } } });
      await prisma.cleaningTask.deleteMany({ where: { id: { in: extraTaskIds } } });
      await prisma.ticketReopenEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.maintenanceTicket.deleteMany({ where: { id: { in: ticketIds } } });
    }
  });
});
