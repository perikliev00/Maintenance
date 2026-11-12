/**
 * archive; / common-area occupancy.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  PrismaClient,
} from "@prisma/client";
import dotenv from "dotenv";
import { createCleaningTask, startCleaningTask } from "../../src/services/cleaning";
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import { archiveLocation, restoreLocation } from "../../src/services/locations";
import { assignMaintenanceTicket, createMaintenanceTicket, listTicketEvents } from "../../src/services/maintenance";
// Shared test fixtures for seeding users, locations, and domain entities.
import { isAppError } from "./fixtures";
import {
  CLN_PASSWORD,
  cleanupReadinessWorld,
  createReadinessWorld,
  findActiveIssueOption,
  getJson,
  getRoomViaApi,
  hotelTodayYmd,
  listenApp,
  closeServer,
  loginBearer,
  patchJson,
  prepareRoomBase,
  resetCleaningWork,
  // Shape ReadinessWorld documents the fixture/response fields this suite touches.
  type ReadinessWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: readiness archive + occupancy (06).
describe("readiness archive + occupancy (06)", () => {
  let world: ReadinessWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createReadinessWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    ownerToken = login.token;
  });

  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
    // Restore archived rooms from prior tests.
    await prisma.location.updateMany({
      where: {
        id: {
          in: [world.locationAId, world.locationBId, world.commonAreaId],
        },
      },
      data: { catalogStatus: "active" },
    });
    await prisma.ticketEvent.deleteMany({
      where: {
        ticket: {
          locationId: {
            in: [world.locationAId, world.locationBId, world.commonAreaId],
          },
        },
      },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: {
        locationId: {
          in: [world.locationAId, world.locationBId, world.commonAreaId],
        },
      },
    });
    await prepareRoomBase(prisma, world.locationAId, CleaningStatus.dirty);
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupReadinessWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Case: archived room drops from ops lists, rejects cleaning/plan, keeps history.
  it("archived room drops from ops lists, rejects cleaning/plan, keeps history", async () => {
    const option = await findActiveIssueOption(prisma);
    // reported: seeded entity required before the mutation under test.
    const reported = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: option.id,
      blocksRoom: true,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    assert.ok(task.id);

    await assignMaintenanceTicket({ ticketId: reported.ticket.id,
      assigneeId: world.technician.employeeId, actorEmployeeId: world.owner.employeeId });
    await createDailyPlanEntry({ hotelDate: today, locationId: world.locationAId,
      category: DailyPlanCategory.priority, createdByEmployeeId: world.owner.employeeId });
    const currentTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId,
      commandId: randomUUID(), expectedVersion: currentTask.version });
    await prisma.cleaningSession.update({ where: { id: started.session.id },
      data: { startedAt: new Date(Date.now() - 24 * 60 * 60_000) } });
    const hk = await loginBearer(api, world.hk1.email, CLN_PASSWORD);
    const tech = await loginBearer(api, world.technician.email, CLN_PASSWORD);
    const taskQueue = `/cleaning/tasks?hotelDate=${today}`;
    const planQueue = `/daily-plan?hotelDate=${today}`;
    const mine = `/my-work?hotelDate=${today}`;
    const queues = [
      [ownerToken, taskQueue, task.id],
      [ownerToken, "/cleaning/sessions/review", started.session.id],
      [ownerToken, "/maintenance/tickets?openOnly=true", reported.ticket.id],
      [ownerToken, planQueue, world.locationAId],
      [hk.token, mine, task.id],
      [tech.token, mine, reported.ticket.id],
    ];
    for (const [token, route, id] of queues) {
      const before = await getJson(api, token, route);
      assert.equal(before.status, 200, route);
      assert.ok(JSON.stringify(before.body).includes(id), `${route} positive control`);
    }
    const liveBefore = await getJson(api, ownerToken, "/operations/live");
    assert.equal(liveBefore.status, 200);
    const liveBeforeBody = liveBefore.body as { activeSessions: Array<{ sessionId: string }>;
      needsAttention: Array<{ location: { id: string } }>;
      counts: { active: number; overdue: number; anomalies: number; blockingTickets: number } };
    assert.ok(liveBeforeBody.activeSessions.some((s) => s.sessionId === started.session.id));

    await archiveLocation(world.locationAId, world.owner.employeeId);

    for (const [token, route, id] of queues) {
      const after = await getJson(api, token, route);
      assert.equal(after.status, 200, route);
      assert.ok(!JSON.stringify(after.body).includes(id), `${route} excludes archived work`);
    }
    const liveAfter = (await getJson(api, ownerToken, "/operations/live")).body as typeof liveBeforeBody;
    assert.ok(!liveAfter.activeSessions.some((s) => s.sessionId === started.session.id));
    assert.ok(!liveAfter.needsAttention.some((item) => item.location.id === world.locationAId));
    for (const counter of ["active", "overdue", "anomalies", "blockingTickets"] as const) {
      assert.equal(liveAfter.counts[counter], liveBeforeBody.counts[counter] - 1, counter);
    }

    const roomsList = await getJson(api, ownerToken, "/rooms");
    assert.equal(roomsList.status, 200);
    const rooms = roomsList.body as { id: string }[] | { items?: { id: string }[] };
    const roomArr = Array.isArray(rooms)
      ? rooms
      : Array.isArray(rooms.items)
        ? rooms.items
        : [];
    assert.ok(
      !roomArr.some((r) => r.id === world.locationAId),
      "archived room must not appear in GET /rooms",
    );

    const single = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.ok(
      single.status === 404 || single.body.catalogStatus === "archived",
      `expected 404 or archived, got ${single.status}`,
    );

    try {
      await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected archived reject on createCleaningTask");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "invalid_state");
      assert.match(err.message, /archived/i);
    }

    try {
      await createDailyPlanEntry({
        hotelDate: today,
        locationId: world.locationAId,
        category: DailyPlanCategory.departure,
        createdByEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected archived reject on createDailyPlanEntry");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "invalid_state");
      assert.match(err.message, /archived/i);
    }

    // History preserved: ticket + events still readable.
    const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: reported.ticket.id },
    });
    assert.equal(ticket.locationId, world.locationAId);
    const events = await listTicketEvents(reported.ticket.id);
    assert.ok(events.length >= 1);
    const ticketHistory = await getJson(api, ownerToken,
      `/maintenance/tickets?locationId=${world.locationAId}&status=all`);
    assert.equal(ticketHistory.status, 200);
    assert.ok((ticketHistory.body as Array<{ id: string }>).some((row) => row.id === ticket.id));

    // Admin catalog may still show archived when requested.
    const catalog = await getJson(
      api,
      ownerToken,
      "/locations?includeArchived=true",
    );
    assert.equal(catalog.status, 200);

    // Archive is a catalog transition: preserve existing work and allow restoration.
    const persistedTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id }, include: { sessions: true } });
    assert.equal(persistedTask.status, "in_progress");
    assert.equal(persistedTask.sessions[0]?.id, started.session.id);
    assert.equal(persistedTask.sessions[0]?.status, "running");
    await restoreLocation(world.locationAId, world.owner.employeeId);
    for (const [token, route, id] of queues) {
      const restored = await getJson(api, token, route);
      assert.equal(restored.status, 200, route);
      assert.ok(JSON.stringify(restored.body).includes(id), `${route} restores existing work`);
    }
  });

  // Case: common-area occupancy rejected without state change.
  it("common-area occupancy rejected without state change", async () => {
    const before = await prisma.location.findUniqueOrThrow({
      where: { id: world.commonAreaId },
    });

    const denied = await patchJson(
      api,
      ownerToken,
      `/locations/${world.commonAreaId}/occupancy`,
      { occupancy: "occupied" },
    );
    assert.equal(denied.status, 400);
    const deniedBody = denied.body as {
      code?: string;
      error?: string;
      message?: string;
    };
    const code = deniedBody.code ?? deniedBody.error;
    assert.equal(code, "validation");
    assert.match(
      JSON.stringify(deniedBody),
      /occupancy|common/i,
    );

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: world.commonAreaId },
    });
    assert.equal(after.occupancy, before.occupancy);

    // Positive control: same actor on a room succeeds.
    await prepareRoomBase(prisma, world.locationBId, CleaningStatus.dirty);
    const ok = await patchJson(
      api,
      ownerToken,
      `/locations/${world.locationBId}/occupancy`,
      { occupancy: "occupied" },
    );
    assert.equal(ok.status, 200);
    const room = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationBId },
    });
    assert.equal(room.occupancy, Occupancy.occupied);
  });
});
