/**
 * 04, — blocking readiness via real tickets + GET /rooms:id.
 * Scenario IDs: , , , (mark-dirty OPEN_TICKET_STATUSES).
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
  InspectionResult,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  ServiceStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  completeCleaningSession,
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  inspectCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import bindings from ../../src/services/maintenance.
import { reopenMaintenanceTicket } from "../../src/services/maintenance";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupReadinessWorld,
  // Concurrency/isolation step for the race under test.
  createBlockingTicketAtStatus,
  // Execute the next setup or assertion step for this scenario.
  createReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  getRoomViaApi,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Execute the next setup or assertion step for this scenario.
  prepareRoomBase,
  // Concurrency/isolation step for the race under test.
  resolveBlockingTicket,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Execute the next setup or assertion step for this scenario.
  withFlagsPatch,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
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

// Suite: readiness blocking lifecycle (04,07 / 34).
describe("readiness blocking lifecycle (04,07 / 34)", () => {
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
    // Await async work before asserting or releasing locks.
    await prisma.ticketReopenEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticket: {
          // Execute the next setup or assertion step for this scenario.
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticket: {
          // Execute the next setup or assertion step for this scenario.
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: { in: [world.locationAId, world.locationBId] },
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

  // Local helper approveClean used by cases in this file.
  async function approveClean(locationId: string) {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Await async work before asserting or releasing locks.
    await withFlagsPatch(world.owner.employeeId, { require_inspection: true }, async () => {
      // task: seeded entity required before the mutation under test.
      const task = await createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // started: synchronize actors so the race window is observable.
      const started = await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      });
      // completed: synchronize actors so the race window is observable.
      const completed = await completeCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: started.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
      });
      // Await async work before asserting or releasing locks.
      await inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: completed.task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        result: InspectionResult.approved,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completed.task.version,
      });
    });
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: locationId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
  }

  // Iterate to cover variants or wait until a condition holds.
  for (const status of ["new", "assigned", "in_progress", "waiting"] as const) {
    // Case probes concurrency/isolation: blocking ${status} keeps not_ready after approved clean.
    it(`blocking ${status} keeps not_ready after approved clean`, async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createBlockingTicketAtStatus(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        world,
        // Execute the next setup or assertion step for this scenario.
        world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        status,
      );
      // Await async work before asserting or releasing locks.
      await approveClean(world.locationAId);

      // room: HTTP response captured for status/body checks.
      const room = await getRoomViaApi(api, ownerToken, world.locationAId);
      // Assert HTTP status matches the contract for this path.
      assert.equal(room.status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.equal(room.body.readiness, "not_ready");
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Concurrency/isolation step for the race under test.
        room.body.readinessReasons?.includes("blocking_issue"),
        // Execute the next setup or assertion step for this scenario.
        `reasons=${JSON.stringify(room.body.readinessReasons)}`,
      );
      // Assert the observed value matches the intended post-condition.
      assert.equal(room.body.cleaningStatus, CleaningStatus.verified_clean);
      // Assert the observed value matches the intended post-condition.
      assert.equal(room.body.occupancy, Occupancy.vacant);
    });
  }

  // Case probes concurrency/isolation: resolving one of two blockers keeps not_ready; last → ready.
  it("resolving one of two blockers keeps not_ready; last → ready", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoomBase(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.verified_clean,
    );
    // a: seeded entity required before the mutation under test.
    const a = await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
    );
    // b: seeded entity required before the mutation under test.
    const b = await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
      // Execute the next setup or assertion step for this scenario.
      world.technician2.employeeId,
    );

    // Await async work before asserting or releasing locks.
    await resolveBlockingTicket(a.id, world.owner.employeeId, "resolve A");
    // room: HTTP response captured for status/body checks.
    let room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "not_ready");
    // Assert the observed value matches the intended post-condition.
    assert.ok(room.body.readinessReasons?.includes("blocking_issue"));

    // Await async work before asserting or releasing locks.
    await resolveBlockingTicket(b.id, world.owner.employeeId, "resolve B");
    // Await async work before asserting or releasing locks.
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "ready");
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(room.body.readinessReasons, []);
  });

  // Case probes concurrency/isolation: after last blocker, remaining occupancy/clean/service block ready.
  it("after last blocker, remaining occupancy/clean/service block ready", async () => {
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
    );

    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        occupancy: Occupancy.occupied,
        // Execute the next setup or assertion step for this scenario.
        cleaningStatus: CleaningStatus.verified_clean,
        // Execute the next setup or assertion step for this scenario.
        serviceStatus: ServiceStatus.in_service,
      },
    });
    // Await async work before asserting or releasing locks.
    await resolveBlockingTicket(ticket.id, world.owner.employeeId);
    // room: HTTP response captured for status/body checks.
    let room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "not_ready");
    // Assert the observed value matches the intended post-condition.
    assert.ok(room.body.readinessReasons?.includes("not_vacant"));

    // ticket2: seeded entity required before the mutation under test.
    const ticket2 = await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
    );
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        occupancy: Occupancy.vacant,
        // Execute the next setup or assertion step for this scenario.
        cleaningStatus: CleaningStatus.dirty,
        // Execute the next setup or assertion step for this scenario.
        serviceStatus: ServiceStatus.in_service,
      },
    });
    // Await async work before asserting or releasing locks.
    await resolveBlockingTicket(ticket2.id, world.owner.employeeId);
    // Await async work before asserting or releasing locks.
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "not_ready");
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      room.body.readinessReasons?.some((r) => r.startsWith("cleaning_")),
    );

    // ticket3: seeded entity required before the mutation under test.
    const ticket3 = await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
    );
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        occupancy: Occupancy.vacant,
        // Execute the next setup or assertion step for this scenario.
        cleaningStatus: CleaningStatus.verified_clean,
        // Execute the next setup or assertion step for this scenario.
        serviceStatus: ServiceStatus.out_of_service,
      },
    });
    // Await async work before asserting or releasing locks.
    await resolveBlockingTicket(ticket3.id, world.owner.employeeId);
    // Await async work before asserting or releasing locks.
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "not_ready");
    // Assert the observed value matches the intended post-condition.
    assert.ok(room.body.readinessReasons?.includes("out_of_service"));

    // Positive: vacant + verified_clean + in_service → ready
    await prepareRoomBase(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.verified_clean,
    );
    // Await async work before asserting or releasing locks.
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "ready");
  });

  // Case probes concurrency/isolation: reopen blocking → not_ready; occupancy/cleaning unchanged.
  it("reopen blocking → not_ready; occupancy/cleaning unchanged", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoomBase(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.verified_clean,
    );
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
    );
    // Await async work before asserting or releasing locks.
    await resolveBlockingTicket(ticket.id, world.owner.employeeId);

    // room: HTTP response captured for status/body checks.
    let room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "ready");
    // Bind occ for later setup or assertions in this scope.
    const occ = room.body.occupancy;
    // Bind clean for later setup or assertions in this scope.
    const clean = room.body.cleaningStatus;

    // Await async work before asserting or releasing locks.
    await reopenMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      reopenedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "still broken",
    });

    // Await async work before asserting or releasing locks.
    room = await getRoomViaApi(api, ownerToken, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.readiness, "not_ready");
    // Assert the observed value matches the intended post-condition.
    assert.ok(room.body.readinessReasons?.includes("blocking_issue"));
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.occupancy, occ);
    // Assert the observed value matches the intended post-condition.
    assert.equal(room.body.cleaningStatus, clean);

    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.vacant);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
  });

  // Case probes concurrency/isolation: mark-dirty response includes assigned/waiting blocking tickets.
  it("mark-dirty response includes assigned/waiting blocking tickets", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoomBase(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.verified_clean,
    );
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      "assigned",
    );
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createBlockingTicketAtStatus(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      "waiting",
      // Execute the next setup or assertion step for this scenario.
      world.technician2.employeeId,
    );
    // Await async work before asserting or releasing locks.
    await prepareRoomBase(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.verified_clean,
    );

    // dirtyA: HTTP response captured for status/body checks.
    const dirtyA = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/rooms/${world.locationAId}/mark-dirty`,
      {},
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(dirtyA.status, 200);
    // Bind bodyA for later setup or assertions in this scope.
    const bodyA = dirtyA.body as {
      // Execute the next setup or assertion step for this scenario.
      readiness?: string;
      // Execute the next setup or assertion step for this scenario.
      readinessReasons?: string[];
      // Concurrency/isolation step for the race under test.
      blockingIssues?: unknown[];
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(bodyA.readiness, "not_ready");
    // Assert the observed value matches the intended post-condition.
    assert.ok(bodyA.readinessReasons?.includes("blocking_issue"));
    // Assert collection size matches the expected post-condition.
    assert.ok((bodyA.blockingIssues?.length ?? 0) >= 1);

    // dirtyB: HTTP response captured for status/body checks.
    const dirtyB = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/rooms/${world.locationBId}/mark-dirty`,
      {},
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(dirtyB.status, 200);
    // Bind bodyB for later setup or assertions in this scope.
    const bodyB = dirtyB.body as {
      // Execute the next setup or assertion step for this scenario.
      readinessReasons?: string[];
      // Concurrency/isolation step for the race under test.
      blockingIssues?: unknown[];
    };
    // Assert the observed value matches the intended post-condition.
    assert.ok(bodyB.readinessReasons?.includes("blocking_issue"));
    // Assert collection size matches the expected post-condition.
    assert.ok((bodyB.blockingIssues?.length ?? 0) >= 1);
  });
});
