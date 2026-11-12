/**
 * archive; / common-area occupancy.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanCategory,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask, startCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import bindings from ../../src/services/locations.
import { archiveLocation, restoreLocation } from "../../src/services/locations";
// Import bindings from ../../src/services/maintenance.
import { assignMaintenanceTicket, createMaintenanceTicket, listTicketEvents } from "../../src/services/maintenance";
// Shared test fixtures for seeding users, locations, and domain entities.
import { isAppError } from "./fixtures";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  createReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  getRoomViaApi,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
  // Execute the next setup or assertion step for this scenario.
  prepareRoomBase,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Shape ReadinessWorld documents the fixture/response fields this suite touches.
  type ReadinessWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: readiness archive + occupancy (06).
describe("readiness archive + occupancy (06)", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: ReadinessWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createReadinessWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // login: synchronize actors so the race window is observable.
    const login = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    // Session/CSRF step exercising auth lifecycle.
    ownerToken = login.token;
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // Restore archived rooms from prior tests.
    await prisma.location.updateMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        id: {
          // Execute the next setup or assertion step for this scenario.
          in: [world.locationAId, world.locationBId, world.commonAreaId],
        },
      },
      // Execute the next setup or assertion step for this scenario.
      data: { catalogStatus: "active" },
    });
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticket: {
          // Execute the next setup or assertion step for this scenario.
          locationId: {
            // Execute the next setup or assertion step for this scenario.
            in: [world.locationAId, world.locationBId, world.commonAreaId],
          },
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: {
          // Execute the next setup or assertion step for this scenario.
          in: [world.locationAId, world.locationBId, world.commonAreaId],
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prepareRoomBase(prisma, world.locationAId, CleaningStatus.dirty);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupReadinessWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: archived room drops from ops lists, rejects cleaning/plan, keeps history.
  it("archived room drops from ops lists, rejects cleaning/plan, keeps history", async () => {
    // option: synchronize actors so the race window is observable.
    const option = await findActiveIssueOption(prisma);
    // reported: seeded entity required before the mutation under test.
    const reported = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: option.id,
      // Concurrency/isolation step for the race under test.
      blocksRoom: true,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(task.id);

    // Await async work before asserting or releasing locks.
    await assignMaintenanceTicket({ ticketId: reported.ticket.id,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: world.technician.employeeId, actorEmployeeId: world.owner.employeeId });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createDailyPlanEntry({ hotelDate: today, locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: DailyPlanCategory.priority, createdByEmployeeId: world.owner.employeeId });
    // currentTask: synchronize actors so the race window is observable.
    const currentTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    // started: synchronize actors so the race window is observable.
    const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(), expectedVersion: currentTask.version });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningSession.update({ where: { id: started.session.id },
      // Execute the next setup or assertion step for this scenario.
      data: { startedAt: new Date(Date.now() - 24 * 60 * 60_000) } });
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(api, world.hk1.email, CLN_PASSWORD);
    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(api, world.technician.email, CLN_PASSWORD);
    // Bind taskQueue for later setup or assertions in this scope.
    const taskQueue = `/cleaning/tasks?hotelDate=${today}`;
    // Bind planQueue for later setup or assertions in this scope.
    const planQueue = `/daily-plan?hotelDate=${today}`;
    // Bind mine for later setup or assertions in this scope.
    const mine = `/my-work?hotelDate=${today}`;
    // Bind queues for later setup or assertions in this scope.
    const queues = [
      // Execute the next setup or assertion step for this scenario.
      [ownerToken, taskQueue, task.id],
      // Session/CSRF step exercising auth lifecycle.
      [ownerToken, "/cleaning/sessions/review", started.session.id],
      // Execute the next setup or assertion step for this scenario.
      [ownerToken, "/maintenance/tickets?openOnly=true", reported.ticket.id],
      // Execute the next setup or assertion step for this scenario.
      [ownerToken, planQueue, world.locationAId],
      // Execute the next setup or assertion step for this scenario.
      [hk.token, mine, task.id],
      // Execute the next setup or assertion step for this scenario.
      [tech.token, mine, reported.ticket.id],
    ];
    // Iterate to cover variants or wait until a condition holds.
    for (const [token, route, id] of queues) {
      // before: HTTP response captured for status/body checks.
      const before = await getJson(api, token, route);
      // Assert HTTP status matches the contract for this path.
      assert.equal(before.status, 200, route);
      // Assert the observed value matches the intended post-condition.
      assert.ok(JSON.stringify(before.body).includes(id), `${route} positive control`);
    }
    // liveBefore: HTTP response captured for status/body checks.
    const liveBefore = await getJson(api, ownerToken, "/operations/live");
    // Assert HTTP status matches the contract for this path.
    assert.equal(liveBefore.status, 200);
    // Bind liveBeforeBody for later setup or assertions in this scope.
    const liveBeforeBody = liveBefore.body as { activeSessions: Array<{ sessionId: string }>;
      // Execute the next setup or assertion step for this scenario.
      needsAttention: Array<{ location: { id: string } }>;
      // Concurrency/isolation step for the race under test.
      counts: { active: number; overdue: number; anomalies: number; blockingTickets: number } };
    // Assert the observed value matches the intended post-condition.
    assert.ok(liveBeforeBody.activeSessions.some((s) => s.sessionId === started.session.id));

    // Await async work before asserting or releasing locks.
    await archiveLocation(world.locationAId, world.owner.employeeId);

    // Iterate to cover variants or wait until a condition holds.
    for (const [token, route, id] of queues) {
      // after: HTTP response captured for status/body checks.
      const after = await getJson(api, token, route);
      // Assert HTTP status matches the contract for this path.
      assert.equal(after.status, 200, route);
      // Assert the observed value matches the intended post-condition.
      assert.ok(!JSON.stringify(after.body).includes(id), `${route} excludes archived work`);
    }
    // liveAfter: HTTP response captured for status/body checks.
    const liveAfter = (await getJson(api, ownerToken, "/operations/live")).body as typeof liveBeforeBody;
    // Assert the observed value matches the intended post-condition.
    assert.ok(!liveAfter.activeSessions.some((s) => s.sessionId === started.session.id));
    // Assert the observed value matches the intended post-condition.
    assert.ok(!liveAfter.needsAttention.some((item) => item.location.id === world.locationAId));
    // Iterate to cover variants or wait until a condition holds.
    for (const counter of ["active", "overdue", "anomalies", "blockingTickets"] as const) {
      // Assert collection size matches the expected post-condition.
      assert.equal(liveAfter.counts[counter], liveBeforeBody.counts[counter] - 1, counter);
    }

    // roomsList: HTTP response captured for status/body checks.
    const roomsList = await getJson(api, ownerToken, "/rooms");
    // Assert HTTP status matches the contract for this path.
    assert.equal(roomsList.status, 200);
    // Bind rooms for later setup or assertions in this scope.
    const rooms = roomsList.body as { id: string }[] | { items?: { id: string }[] };
    // Bind roomArr for later setup or assertions in this scope.
    const roomArr = Array.isArray(rooms)
      ? rooms
      : Array.isArray(rooms.items)
        ? rooms.items
        : [];
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      !roomArr.some((r) => r.id === world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      "archived room must not appear in GET /rooms",
    );

    // single: HTTP response captured for status/body checks.
    const single = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      single.status === 404 || single.body.catalogStatus === "archived",
      // Execute the next setup or assertion step for this scenario.
      `expected 404 or archived, got ${single.status}`,
    );

    // Try path where partial failure must not leak suite state.
    try {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected archived reject on createCleaningTask");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "invalid_state");
      // Assert the observed value matches the intended post-condition.
      assert.match(err.message, /archived/i);
    }

    // Try path where partial failure must not leak suite state.
    try {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createDailyPlanEntry({
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.departure,
        // Execute the next setup or assertion step for this scenario.
        createdByEmployeeId: world.owner.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected archived reject on createDailyPlanEntry");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "invalid_state");
      // Assert the observed value matches the intended post-condition.
      assert.match(err.message, /archived/i);
    }

    // History preserved: ticket + events still readable.
    const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: reported.ticket.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(ticket.locationId, world.locationAId);
    // events: synchronize actors so the race window is observable.
    const events = await listTicketEvents(reported.ticket.id);
    // Assert collection size matches the expected post-condition.
    assert.ok(events.length >= 1);
    // ticketHistory: HTTP response captured for status/body checks.
    const ticketHistory = await getJson(api, ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets?locationId=${world.locationAId}&status=all`);
    // Assert HTTP status matches the contract for this path.
    assert.equal(ticketHistory.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.ok((ticketHistory.body as Array<{ id: string }>).some((row) => row.id === ticket.id));

    // Admin catalog may still show archived when requested.
    const catalog = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      "/locations?includeArchived=true",
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(catalog.status, 200);

    // Archive is a catalog transition: preserve existing work and allow restoration.
    const persistedTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id }, include: { sessions: true } });
    // Assert HTTP status matches the contract for this path.
    assert.equal(persistedTask.status, "in_progress");
    // Assert the observed value matches the intended post-condition.
    assert.equal(persistedTask.sessions[0]?.id, started.session.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(persistedTask.sessions[0]?.status, "running");
    // Await async work before asserting or releasing locks.
    await restoreLocation(world.locationAId, world.owner.employeeId);
    // Iterate to cover variants or wait until a condition holds.
    for (const [token, route, id] of queues) {
      // restored: HTTP response captured for status/body checks.
      const restored = await getJson(api, token, route);
      // Assert HTTP status matches the contract for this path.
      assert.equal(restored.status, 200, route);
      // Assert the observed value matches the intended post-condition.
      assert.ok(JSON.stringify(restored.body).includes(id), `${route} restores existing work`);
    }
  });

  // Case: common-area occupancy rejected without state change.
  it("common-area occupancy rejected without state change", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.commonAreaId },
    });

    // denied: HTTP response captured for status/body checks.
    const denied = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/locations/${world.commonAreaId}/occupancy`,
      // Execute the next setup or assertion step for this scenario.
      { occupancy: "occupied" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(denied.status, 400);
    // Bind deniedBody for later setup or assertions in this scope.
    const deniedBody = denied.body as {
      // Execute the next setup or assertion step for this scenario.
      code?: string;
      // Execute the next setup or assertion step for this scenario.
      error?: string;
      // Execute the next setup or assertion step for this scenario.
      message?: string;
    };
    // Bind code for later setup or assertions in this scope.
    const code = deniedBody.code ?? deniedBody.error;
    // Assert the observed value matches the intended post-condition.
    assert.equal(code, "validation");
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      JSON.stringify(deniedBody),
      // Execute the next setup or assertion step for this scenario.
      /occupancy|common/i,
    );

    // after: synchronize actors so the race window is observable.
    const after = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.commonAreaId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.occupancy, before.occupancy);

    // Positive control: same actor on a room succeeds.
    await prepareRoomBase(prisma, world.locationBId, CleaningStatus.dirty);
    // ok: HTTP response captured for status/body checks.
    const ok = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/locations/${world.locationBId}/occupancy`,
      // Execute the next setup or assertion step for this scenario.
      { occupancy: "occupied" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(ok.status, 200);
    // room: synchronize actors so the race window is observable.
    const room = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationBId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.occupancy, Occupancy.occupied);
  });
});
