/**
 * Archive vs cleaning/ticket assignment: whichever commits first must make the
 * other refuse — never archived-with-open-work or assign-to-archived.
 *
 * createCleaningTask takes Location FOR UPDATE before User FOR SHARE. If the
 * fixture location already has an active task for today's hotel date, create
 * returns conflict before reaching the User lock and the barrier never sees
 * two waiters. Each case therefore owns a fresh location with no active task.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CatalogStatus,
  // Execute the next setup or assertion step for this scenario.
  LocationKind,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
  // Execute the next setup or assertion step for this scenario.
  TicketStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace, withDatabaseBarrier } from "../dbBarrier";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/people/lifecycle.
import { archivePerson } from "../../src/services/people/lifecycle";
// Import bindings from ../../src/services/maintenance.
import { assignMaintenanceTicket } from "../../src/services/maintenance";
// Import bindings from ../../src/services/hotelTime.
import { todayHotelDateYmd } from "../../src/services/hotelTime";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Shape Settled documents the fixture/response fields this suite touches.
type Settled = PromiseSettledResult<unknown>;

// Local helper rejectedAppError used by cases in this file.
function rejectedAppError(settled: Settled[]): AppError {
  // Bind rejected for later setup or assertions in this scope.
  const rejected = settled.find((s) => s.status === "rejected");
  // Assert HTTP status matches the contract for this path.
  assert.ok(rejected && rejected.status === "rejected", "expected a rejection");
  // Assert the observed value matches the intended post-condition.
  assert.ok(rejected.reason instanceof AppError, String(rejected.reason));
  // Return the arranged value/result to the caller.
  return rejected.reason;
}

// Local helper fulfilledCount used by cases in this file.
function fulfilledCount(settled: Settled[]): number {
  // Return the arranged value/result to the caller.
  return settled.filter((s) => s.status === "fulfilled").length;
}

// Suite: archive × assign concurrency.
describe("archive × assign concurrency", () => {
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  const fixtureIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  const locationIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  let actor: Awaited<ReturnType<typeof createEmployeeWithUser>>;
  // Execute the next setup or assertion step for this scenario.
  let propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  let buildingId: string;
  // Execute the next setup or assertion step for this scenario.
  let floorId: string;

  // Local helper freshLocation used by cases in this file.
  async function freshLocation(label: string): Promise<string> {
    // location: seeded entity required before the mutation under test.
    const location = await prisma.location.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        floorId,
        // Execute the next setup or assertion step for this scenario.
        number: `AA-${label}-${Date.now()}`.slice(0, 24),
        // Execute the next setup or assertion step for this scenario.
        kind: LocationKind.room,
        // Execute the next setup or assertion step for this scenario.
        catalogStatus: CatalogStatus.active,
      },
    });
    // Execute the next setup or assertion step for this scenario.
    locationIds.push(location.id);
    // Return the arranged value/result to the caller.
    return location.id;
  }

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    actor = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-ACT-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-act-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.manager,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Actor",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(actor.employeeId);
    // property: seeded entity required before the mutation under test.
    const property = await prisma.property.create({
      // Execute the next setup or assertion step for this scenario.
      data: { name: `AA Property ${stamp}` },
    });
    // Execute the next setup or assertion step for this scenario.
    propertyId = property.id;
    // building: seeded entity required before the mutation under test.
    const building = await prisma.building.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        propertyId: property.id,
        // Fixture field name for the seeded actor/entity.
        name: "AA Building",
        // Execute the next setup or assertion step for this scenario.
        code: `AAB-${stamp}`.slice(0, 32),
      },
    });
    // Execute the next setup or assertion step for this scenario.
    buildingId = building.id;
    // floor: seeded entity required before the mutation under test.
    const floor = await prisma.floor.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        buildingId: building.id,
        // Execute the next setup or assertion step for this scenario.
        number: 91,
        // Fixture field name for the seeded actor/entity.
        name: "AA Floor",
      },
    });
    // Execute the next setup or assertion step for this scenario.
    floorId = floor.id;
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // tickets: synchronize actors so the race window is observable.
    const tickets = await prisma.maintenanceTicket.findMany({
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      where: { reportedByEmployeeId: { in: fixtureIds } },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true },
    });
    // Bind ticketIds for later setup or assertions in this scope.
    const ticketIds = tickets.map((t) => t.id);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (ticketIds.length) {
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { ticketId: { in: ticketIds } },
      });
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceTicket.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: { in: ticketIds } },
      });
    }
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // SQL fragment used to observe locks or assert DB state.
        OR: [
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          { assignedEmployeeId: { in: fixtureIds } },
          // Execute the next setup or assertion step for this scenario.
          { locationId: { in: locationIds } },
        ],
      },
    });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (locationIds.length) {
      // Await async work before asserting or releasing locks.
      await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (floorId) await prisma.floor.deleteMany({ where: { id: floorId } });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (buildingId) {
      // Await async work before asserting or releasing locks.
      await prisma.building.deleteMany({ where: { id: buildingId } });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (propertyId) {
      // Await async work before asserting or releasing locks.
      await prisma.property.deleteMany({ where: { id: propertyId } });
    }
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case probes concurrency/isolation: cleaning assign vs archive — coherent winner (simultaneous).
  it("cleaning assign vs archive — coherent winner (simultaneous)", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // worker: seeded entity required before the mutation under test.
    const worker = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-W1-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-w1-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Worker1",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(worker.employeeId);
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = await freshLocation("sim");
    // Bind version for later setup or assertions in this scope.
    const version = (
      // Await async work before asserting or releasing locks.
      await prisma.employee.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: worker.employeeId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).accessVersion;
    // hotelDate: synchronize actors so the race window is observable.
    const hotelDate = await todayHotelDateYmd();

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          createCleaningTask({
            // Execute the next setup or assertion step for this scenario.
            locationId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate,
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: worker.employeeId,
            // Execute the next setup or assertion step for this scenario.
            serviceType: "stayover",
          }),
          // Execute the next setup or assertion step for this scenario.
          archivePerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: actor.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: actor.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            worker.employeeId,
            // Execute the next setup or assertion step for this scenario.
            "active",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // Assert the observed value matches the intended post-condition.
    assert.equal(fulfilledCount(settled), 1, JSON.stringify(settled, null, 2));
    // emp: synchronize actors so the race window is observable.
    const emp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: worker.employeeId },
    });
    // open: synchronize actors so the race window is observable.
    const open = await prisma.cleaningTask.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: worker.employeeId,
        // Fixture field status for the seeded actor/entity.
        status: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.assigned,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.in_progress,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.awaiting_inspection,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.rework,
          ],
        },
      },
    });

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (emp.archivedAt) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(open, 0);
      // Bind reason for later setup or assertions in this scope.
      const reason = rejectedAppError(settled);
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        reason.code === "conflict" ||
          // Execute the next setup or assertion step for this scenario.
          reason.code === "validation" ||
          // Execute the next setup or assertion step for this scenario.
          reason.status === 400,
        // Execute the next setup or assertion step for this scenario.
        `archive won; assign rejection=${reason.code}`,
      );
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.ok(open >= 1);
      // Bind reason for later setup or assertions in this scope.
      const reason = rejectedAppError(settled);
      // Assert the observed value matches the intended post-condition.
      assert.equal(reason.code, "unfinished_work");
    }
  });

  // Case probes concurrency/isolation: cleaning assign wins ordered race → archive unfinished_work.
  it("cleaning assign wins ordered race → archive unfinished_work", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // worker: seeded entity required before the mutation under test.
    const worker = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-W3-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-w3-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Worker3",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(worker.employeeId);
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = await freshLocation("aw");
    // Bind version for later setup or assertions in this scope.
    const version = (
      // Await async work before asserting or releasing locks.
      await prisma.employee.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: worker.employeeId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).accessVersion;
    // hotelDate: synchronize actors so the race window is observable.
    const hotelDate = await todayHotelDateYmd();

    // settled: synchronize actors so the race window is observable.
    const settled = await orderedDatabaseRace(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          locationId,
          // Execute the next setup or assertion step for this scenario.
          hotelDate,
          // Execute the next setup or assertion step for this scenario.
          assignedEmployeeId: worker.employeeId,
          // Execute the next setup or assertion step for this scenario.
          serviceType: "stayover",
        }),
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        archivePerson(
          {
            // Execute the next setup or assertion step for this scenario.
            userId: actor.userId,
            // Execute the next setup or assertion step for this scenario.
            employeeId: actor.employeeId,
            // Fixture field role for the seeded actor/entity.
            role: Role.manager,
          },
          // Execute the next setup or assertion step for this scenario.
          worker.employeeId,
          // Execute the next setup or assertion step for this scenario.
          "active",
          // Execute the next setup or assertion step for this scenario.
          version,
        ),
    );

    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[0]?.status, "fulfilled", JSON.stringify(settled));
    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[1]?.status, "rejected", JSON.stringify(settled));
    // Bind reason for later setup or assertions in this scope.
    const reason = rejectedAppError(settled);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reason.code, "unfinished_work");

    // emp: synchronize actors so the race window is observable.
    const emp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: worker.employeeId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(emp.archivedAt, null);
    // open: synchronize actors so the race window is observable.
    const open = await prisma.cleaningTask.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: worker.employeeId,
        // Fixture field status for the seeded actor/entity.
        status: TaskStatus.assigned,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(open, 1);
  });

  // Case probes concurrency/isolation: archive wins ordered race → cleaning assign refuses.
  it("archive wins ordered race → cleaning assign refuses", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // worker: seeded entity required before the mutation under test.
    const worker = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-W4-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-w4-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Worker4",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(worker.employeeId);
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = await freshLocation("ar");
    // Bind version for later setup or assertions in this scope.
    const version = (
      // Await async work before asserting or releasing locks.
      await prisma.employee.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: worker.employeeId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).accessVersion;
    // hotelDate: synchronize actors so the race window is observable.
    const hotelDate = await todayHotelDateYmd();

    // settled: synchronize actors so the race window is observable.
    const settled = await orderedDatabaseRace(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        archivePerson(
          {
            // Execute the next setup or assertion step for this scenario.
            userId: actor.userId,
            // Execute the next setup or assertion step for this scenario.
            employeeId: actor.employeeId,
            // Fixture field role for the seeded actor/entity.
            role: Role.manager,
          },
          // Execute the next setup or assertion step for this scenario.
          worker.employeeId,
          // Execute the next setup or assertion step for this scenario.
          "active",
          // Execute the next setup or assertion step for this scenario.
          version,
        ),
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          locationId,
          // Execute the next setup or assertion step for this scenario.
          hotelDate,
          // Execute the next setup or assertion step for this scenario.
          assignedEmployeeId: worker.employeeId,
          // Execute the next setup or assertion step for this scenario.
          serviceType: "stayover",
        }),
    );

    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[0]?.status, "fulfilled", JSON.stringify(settled));
    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[1]?.status, "rejected", JSON.stringify(settled));
    // Bind reason for later setup or assertions in this scope.
    const reason = rejectedAppError(settled);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      reason.status === 400 || reason.code === "validation",
      // Execute the next setup or assertion step for this scenario.
      `assign rejection=${reason.code}/${reason.status}`,
    );

    // emp: synchronize actors so the race window is observable.
    const emp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: worker.employeeId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(emp.archivedAt);
    // open: synchronize actors so the race window is observable.
    const open = await prisma.cleaningTask.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: worker.employeeId,
        // Fixture field status for the seeded actor/entity.
        status: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.assigned,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.in_progress,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.awaiting_inspection,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.rework,
          ],
        },
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(open, 0);
  });

  // Case: archive then assign sequentially refuses archived employee.
  it("archive then assign sequentially refuses archived employee", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // worker: seeded entity required before the mutation under test.
    const worker = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-W2-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-w2-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Worker2",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(worker.employeeId);
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = await freshLocation("seq");
    // Bind version for later setup or assertions in this scope.
    const version = (
      // Await async work before asserting or releasing locks.
      await prisma.employee.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: worker.employeeId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).accessVersion;
    // hotelDate: synchronize actors so the race window is observable.
    const hotelDate = await todayHotelDateYmd();

    // Await async work before asserting or releasing locks.
    await archivePerson(
      {
        // Execute the next setup or assertion step for this scenario.
        userId: actor.userId,
        // Execute the next setup or assertion step for this scenario.
        employeeId: actor.employeeId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Execute the next setup or assertion step for this scenario.
      worker.employeeId,
      // Execute the next setup or assertion step for this scenario.
      "active",
      // Execute the next setup or assertion step for this scenario.
      version,
    );

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          locationId,
          // Execute the next setup or assertion step for this scenario.
          hotelDate,
          // Execute the next setup or assertion step for this scenario.
          assignedEmployeeId: worker.employeeId,
          // Execute the next setup or assertion step for this scenario.
          serviceType: "stayover",
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
  });

  // Case: assign then archive sequentially refuses unfinished_work.
  it("assign then archive sequentially refuses unfinished_work", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // worker: seeded entity required before the mutation under test.
    const worker = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-W5-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-w5-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Worker5",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(worker.employeeId);
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = await freshLocation("sa");
    // Bind version for later setup or assertions in this scope.
    const version = (
      // Await async work before asserting or releasing locks.
      await prisma.employee.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: worker.employeeId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).accessVersion;
    // hotelDate: synchronize actors so the race window is observable.
    const hotelDate = await todayHotelDateYmd();

    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: worker.employeeId,
      // Execute the next setup or assertion step for this scenario.
      serviceType: "stayover",
    });

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        archivePerson(
          {
            // Execute the next setup or assertion step for this scenario.
            userId: actor.userId,
            // Execute the next setup or assertion step for this scenario.
            employeeId: actor.employeeId,
            // Fixture field role for the seeded actor/entity.
            role: Role.manager,
          },
          // Execute the next setup or assertion step for this scenario.
          worker.employeeId,
          // Execute the next setup or assertion step for this scenario.
          "active",
          // Execute the next setup or assertion step for this scenario.
          version,
        ),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError && err.code === "unfinished_work",
    );
  });

  // Case probes concurrency/isolation: ticket assign races with archive — winner leaves coherent state.
  it("ticket assign races with archive — winner leaves coherent state", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // tech: seeded entity required before the mutation under test.
    const tech = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-AA-T1-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-aa-t1-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.technician,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Archive Assign Tech1",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(tech.employeeId);
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = await freshLocation("tk");
    // Bind version for later setup or assertions in this scope.
    const version = (
      // Await async work before asserting or releasing locks.
      await prisma.employee.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: tech.employeeId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).accessVersion;

    // ticket: seeded entity required before the mutation under test.
    const ticket = await prisma.maintenanceTicket.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        title: `AA-ticket-${stamp}`,
        // Execute the next setup or assertion step for this scenario.
        categoryKey: "other",
        // Execute the next setup or assertion step for this scenario.
        categoryLabelBg: "Друго",
        // Execute the next setup or assertion step for this scenario.
        categoryLabelEn: "Other",
        // Execute the next setup or assertion step for this scenario.
        reportedByEmployeeId: actor.employeeId,
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.new,
      },
    });

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${tech.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          assignMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            assigneeId: tech.employeeId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: actor.employeeId,
          }),
          // Execute the next setup or assertion step for this scenario.
          archivePerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: actor.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: actor.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            tech.employeeId,
            // Execute the next setup or assertion step for this scenario.
            "active",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // emp: synchronize actors so the race window is observable.
    const emp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: tech.employeeId },
    });
    // assigned: synchronize actors so the race window is observable.
    const assigned = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });

    // Coherent outcomes only: never archived-with-this-assignee.
    if (emp.archivedAt) {
      // Assert the observed value matches the intended post-condition.
      assert.notEqual(assigned.assigneeId, tech.employeeId);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.equal(assigned.assigneeId, tech.employeeId);
      // Bind reason for later setup or assertions in this scope.
      const reason = rejectedAppError(settled);
      // Assert the observed value matches the intended post-condition.
      assert.equal(reason.code, "unfinished_work");
    }
  });
});
