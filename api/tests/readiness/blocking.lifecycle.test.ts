/**
 * 04, — blocking readiness via real tickets + GET /rooms:id.
 * Scenario IDs: , , , (mark-dirty OPEN_TICKET_STATUSES).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import {
  CleaningStatus,
  InspectionResult,
  Occupancy,
  PrismaClient,
  ServiceStatus,
} from "@prisma/client";
import dotenv from "dotenv";
import {
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import { reopenMaintenanceTicket } from "../../src/services/maintenance";
import {
  CLN_PASSWORD,
  cleanupReadinessWorld,
  createBlockingTicketAtStatus,
  createReadinessWorld,
  getRoomViaApi,
  listenApp,
  closeServer,
  loginBearer,
  postJson,
  prepareRoomBase,
  resolveBlockingTicket,
  resetCleaningWork,
  withFlagsPatch,
  hotelTodayYmd,
  // Shape ReadinessWorld documents the fixture/response fields this suite touches.
  type ReadinessWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: readiness blocking lifecycle (04,07 / 34).
describe("readiness blocking lifecycle (04,07 / 34)", () => {
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
    await prisma.ticketReopenEvent.deleteMany({
      where: {
        ticket: {
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    await prisma.ticketEvent.deleteMany({
      where: {
        ticket: {
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: {
        locationId: { in: [world.locationAId, world.locationBId] },
      },
    });
    await prepareRoomBase(prisma, world.locationAId, CleaningStatus.dirty);
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupReadinessWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Local helper approveClean used by cases in this file.
  async function approveClean(locationId: string) {
    const today = await hotelTodayYmd();
    await withFlagsPatch(world.owner.employeeId, { require_inspection: true }, async () => {
      const task = await createCleaningTask({
        locationId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      const started = await startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: task.version,
      });
      const completed = await completeCleaningSession({
        sessionId: started.session.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: started.task.version,
      });
      await inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.owner.employeeId,
        result: InspectionResult.approved,
        commandId: randomUUID(),
        expectedVersion: completed.task.version,
      });
    });
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: locationId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
  }

  for (const status of ["new", "assigned", "in_progress", "waiting"] as const) {
    // Case probes concurrency/isolation: blocking ${status} keeps not_ready after approved clean.
    it(`blocking ${status} keeps not_ready after approved clean`, async () => {
      await createBlockingTicketAtStatus(
        prisma,
        world,
        world.locationAId,
        status,
      );
      await approveClean(world.locationAId);

      const room = await getRoomViaApi(api, ownerToken, world.locationAId);
      assert.equal(room.status, 200);
      assert.equal(room.body.readiness, "not_ready");
      assert.ok(
        room.body.readinessReasons?.includes("blocking_issue"),
        `reasons=${JSON.stringify(room.body.readinessReasons)}`,
      );
      assert.equal(room.body.cleaningStatus, CleaningStatus.verified_clean);
      assert.equal(room.body.occupancy, Occupancy.vacant);
    });
  }

  // Case probes concurrency/isolation: resolving one of two blockers keeps not_ready; last → ready.
  it("resolving one of two blockers keeps not_ready; last → ready", async () => {
    await prepareRoomBase(
      prisma,
      world.locationAId,
      CleaningStatus.verified_clean,
    );
    // a: seeded entity required before the mutation under test.
    const a = await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "in_progress",
    );
    // b: seeded entity required before the mutation under test.
    const b = await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "in_progress",
      world.technician2.employeeId,
    );

    await resolveBlockingTicket(a.id, world.owner.employeeId, "resolve A");
    let room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "not_ready");
    assert.ok(room.body.readinessReasons?.includes("blocking_issue"));

    await resolveBlockingTicket(b.id, world.owner.employeeId, "resolve B");
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "ready");
    assert.deepEqual(room.body.readinessReasons, []);
  });

  // Case probes concurrency/isolation: after last blocker, remaining occupancy/clean/service block ready.
  it("after last blocker, remaining occupancy/clean/service block ready", async () => {
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "in_progress",
    );

    await prisma.location.update({
      where: { id: world.locationAId },
      data: {
        occupancy: Occupancy.occupied,
        cleaningStatus: CleaningStatus.verified_clean,
        serviceStatus: ServiceStatus.in_service,
      },
    });
    await resolveBlockingTicket(ticket.id, world.owner.employeeId);
    let room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "not_ready");
    assert.ok(room.body.readinessReasons?.includes("not_vacant"));

    // ticket2: seeded entity required before the mutation under test.
    const ticket2 = await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "in_progress",
    );
    await prisma.location.update({
      where: { id: world.locationAId },
      data: {
        occupancy: Occupancy.vacant,
        cleaningStatus: CleaningStatus.dirty,
        serviceStatus: ServiceStatus.in_service,
      },
    });
    await resolveBlockingTicket(ticket2.id, world.owner.employeeId);
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "not_ready");
    assert.ok(
      room.body.readinessReasons?.some((r) => r.startsWith("cleaning_")),
    );

    // ticket3: seeded entity required before the mutation under test.
    const ticket3 = await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "in_progress",
    );
    await prisma.location.update({
      where: { id: world.locationAId },
      data: {
        occupancy: Occupancy.vacant,
        cleaningStatus: CleaningStatus.verified_clean,
        serviceStatus: ServiceStatus.out_of_service,
      },
    });
    await resolveBlockingTicket(ticket3.id, world.owner.employeeId);
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "not_ready");
    assert.ok(room.body.readinessReasons?.includes("out_of_service"));

    // Positive: vacant + verified_clean + in_service → ready
    await prepareRoomBase(
      prisma,
      world.locationAId,
      CleaningStatus.verified_clean,
    );
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "ready");
  });

  // Case probes concurrency/isolation: reopen blocking → not_ready; occupancy/cleaning unchanged.
  it("reopen blocking → not_ready; occupancy/cleaning unchanged", async () => {
    await prepareRoomBase(
      prisma,
      world.locationAId,
      CleaningStatus.verified_clean,
    );
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "in_progress",
    );
    await resolveBlockingTicket(ticket.id, world.owner.employeeId);

    let room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "ready");
    const occ = room.body.occupancy;
    const clean = room.body.cleaningStatus;

    await reopenMaintenanceTicket({
      ticketId: ticket.id,
      reopenedByEmployeeId: world.owner.employeeId,
      reason: "still broken",
    });

    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.equal(room.body.readiness, "not_ready");
    assert.ok(room.body.readinessReasons?.includes("blocking_issue"));
    assert.equal(room.body.occupancy, occ);
    assert.equal(room.body.cleaningStatus, clean);

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.occupancy, Occupancy.vacant);
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
  });

  // Case probes concurrency/isolation: mark-dirty response includes assigned/waiting blocking tickets.
  it("mark-dirty response includes assigned/waiting blocking tickets", async () => {
    await prepareRoomBase(
      prisma,
      world.locationAId,
      CleaningStatus.verified_clean,
    );
    await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationAId,
      "assigned",
    );
    await createBlockingTicketAtStatus(
      prisma,
      world,
      world.locationBId,
      "waiting",
      world.technician2.employeeId,
    );
    await prepareRoomBase(
      prisma,
      world.locationBId,
      CleaningStatus.verified_clean,
    );

    const dirtyA = await postJson(
      api,
      ownerToken,
      `/rooms/${world.locationAId}/mark-dirty`,
      {},
    );
    assert.equal(dirtyA.status, 200);
    const bodyA = dirtyA.body as {
      readiness?: string;
      readinessReasons?: string[];
      blockingIssues?: unknown[];
    };
    assert.equal(bodyA.readiness, "not_ready");
    assert.ok(bodyA.readinessReasons?.includes("blocking_issue"));
    assert.ok((bodyA.blockingIssues?.length ?? 0) >= 1);

    const dirtyB = await postJson(
      api,
      ownerToken,
      `/rooms/${world.locationBId}/mark-dirty`,
      {},
    );
    assert.equal(dirtyB.status, 200);
    const bodyB = dirtyB.body as {
      readinessReasons?: string[];
      blockingIssues?: unknown[];
    };
    assert.ok(bodyB.readinessReasons?.includes("blocking_issue"));
    assert.ok((bodyB.blockingIssues?.length ?? 0) >= 1);
  });
});
