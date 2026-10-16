/**
 * HTTP integration: T-SCOPE-LOC-01, T-SCOPE-TKT-01, T-AUDIT-HTTP-01,
 * T-SCOPE-SEC-01, T-SCOPE-AGG-01.
 */
import assert from "node:assert/strict";
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
  type AggregateSeedIds,
  type EmployeeUserFixture,
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
  restoreRoleGrants,
  snapshotRoleGrants,
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
const OUT_OF_SCOPE = "Outside your permitted data scope";

function assertOutOfScope(res: { status: number; body: unknown }, label: string) {
  assert.equal(res.status, 403, `${label} → ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal((res.body as { error?: string }).error, "forbidden");
  assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
}

describe("dataScope HTTP (P1-06 … P1-10 / P1-08)", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";
  let fx: ScopeSmokeFixture;
  let technician: EmployeeUserFixture;
  let owner: EmployeeUserFixture;
  let grantSnap: RoleGrantSnapshotRow[] = [];

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    invalidateGrantCache();
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

  it("T-SCOPE-LOC-01: OOS location mutations denied", async () => {
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

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: fx.locBId },
    });
    assert.equal(after.occupancy, loc.occupancy);
    assert.equal(after.serviceStatus, loc.serviceStatus);
    assert.equal(after.catalogStatus, loc.catalogStatus);
    assert.equal(after.cleaningStatus, loc.cleaningStatus);
  });

  it("T-SCOPE-TKT-01: OOS ticket lifecycle denied", async () => {
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

  it("T-AUDIT-HTTP-01: omit/swap locationId for location-only audit", async () => {
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
        actions.push("operations.view_live");
      }
      const put = await putJson(
        api,
        ownerTok,
        "/permissions/roles/supervisor",
        { panels: g.panels, actions },
      );
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

  it("T-SCOPE-SEC-01: sector deactivate refreshes next read/action", async () => {
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

    const roomsBefore = await getJson(api, supTok, "/rooms");
    assert.equal(roomsBefore.status, 200);
    const idsBefore = (roomsBefore.body as Array<{ id: string }>).map(
      (r) => r.id,
    );
    assert.ok(idsBefore.includes(fx.locAId));

    const deact = await patchJson(api, mgrTok, `/sectors/${fx.sectorAId}`, {
      isActive: false,
    });
    assert.equal(deact.status, 200, JSON.stringify(deact.body));

    try {
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
      });
    }
  });

  it("T-SCOPE-AGG-01: plan/live/results/analytics scoped aggregates", async () => {
    let seed: AggregateSeedIds | null = null;
    try {
      seed = await seedScopeAggregateExtras(prisma, fx);
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

      const planA = await getJson(
        api,
        supTok,
        `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
      );
      const planAll = await getJson(
        api,
        mgrTok,
        `/daily-plan?hotelDate=${seed.hotelDateYmd}`,
      );
      assert.equal(planA.status, 200);
      assert.equal(planAll.status, 200);
      type PlanEntry = { room?: { id?: string } };
      const entriesA = [
        ...((planA.body as { departures?: PlanEntry[] }).departures ?? []),
        ...((planA.body as { arrivals?: PlanEntry[] }).arrivals ?? []),
        ...((planA.body as { priority?: PlanEntry[] }).priority ?? []),
      ];
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

      // Make tickets visible on the live board (blocking open tickets → needsAttention).
      await prisma.maintenanceTicket.updateMany({
        where: { id: { in: [fx.ticketAId, fx.ticketBId] } },
        data: { blocksRoom: true },
      });

      const liveA = await getJson(api, supTok, "/operations/live");
      const liveAll = await getJson(api, mgrTok, "/operations/live");
      assert.equal(liveA.status, 200);
      assert.equal(liveAll.status, 200);
      type LiveNeed = {
        kind?: string;
        id?: string;
        location?: { id?: string };
      };
      const liveBodyA = liveA.body as {
        needsAttention?: LiveNeed[];
        counts?: { blockingTickets?: number };
      };
      const liveBodyAll = liveAll.body as {
        needsAttention?: LiveNeed[];
        counts?: { blockingTickets?: number };
      };
      const attentionA = liveBodyA.needsAttention ?? [];
      const attentionAll = liveBodyAll.needsAttention ?? [];
      const idsA = attentionA.map((r) => r.id);
      const idsAll = attentionAll.map((r) => r.id);

      // Positive control: supervisor A must see own blocking ticket by id.
      assert.ok(
        idsA.includes(fx.ticketAId),
        `live A missing ticketA ${fx.ticketAId}; ids=${idsA.join(",")}`,
      );
      // Negative: foreign ticket B must not appear in A’s board.
      assert.equal(idsA.includes(fx.ticketBId), false);
      // Manager all-scope must include both (positive control for B visibility).
      assert.ok(
        idsAll.includes(fx.ticketAId) && idsAll.includes(fx.ticketBId),
        `live all missing tickets; ids=${idsAll.join(",")}`,
      );
      assert.ok(
        (liveBodyA.counts?.blockingTickets ?? 0) <
          (liveBodyAll.counts?.blockingTickets ?? 0),
        `blockingTickets A=${liveBodyA.counts?.blockingTickets} all=${liveBodyAll.counts?.blockingTickets}`,
      );

      const resultsA = await getJson(
        api,
        supTok,
        `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pageSize=100`,
      );
      const resultsAll = await getJson(
        api,
        mgrTok,
        `/cleaning/results?from=${seed.fromIso}&to=${seed.toIso}&pageSize=100`,
      );
      assert.equal(resultsA.status, 200);
      assert.equal(resultsAll.status, 200);
      const summaryA = (resultsA.body as { summary?: { completedTasks?: number } })
        .summary;
      const summaryAll = (
        resultsAll.body as { summary?: { completedTasks?: number } }
      ).summary;
      assert.ok(summaryA && summaryAll);
      assert.ok(
        (summaryA.completedTasks ?? 0) < (summaryAll.completedTasks ?? 0),
        `results completedTasks A=${summaryA.completedTasks} all=${summaryAll.completedTasks}`,
      );

      const analyticsA = await getJson(
        api,
        supTok,
        `/analytics/summary?domain=housekeeping&from=${seed.fromIso}&to=${seed.toIso}`,
      );
      const analyticsAll = await getJson(
        api,
        mgrTok,
        `/analytics/summary?domain=housekeeping&from=${seed.fromIso}&to=${seed.toIso}`,
      );
      assert.equal(analyticsA.status, 200);
      assert.equal(analyticsAll.status, 200);
      // Prefer completedTasks / roomsCleaned style metrics when present.
      const cleanedA = (
        analyticsA.body as { kpis?: { cleanedTasks?: number } }
      ).kpis?.cleanedTasks;
      const cleanedAll = (
        analyticsAll.body as { kpis?: { cleanedTasks?: number } }
      ).kpis?.cleanedTasks;
      assert.equal(typeof cleanedA, "number");
      assert.equal(typeof cleanedAll, "number");
      assert.ok(
        (cleanedA as number) < (cleanedAll as number),
        `analytics cleanedTasks A=${cleanedA} all=${cleanedAll}`,
      );
    } finally {
      if (seed) await cleanupAggregateSeed(prisma, seed);
    }
  });
});
