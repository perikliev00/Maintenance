/**
 * Shared world + helpers for readiness / archive / occupancy integration tests
 * (P1-31…P1-36). Lives under api/tests/readiness/ (outside parallel npm test glob).
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  Priority,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Execute the next setup or assertion step for this scenario.
  ServiceStatus,
  // Execute the next setup or assertion step for this scenario.
  TicketStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  assignMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  createMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  resolveMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  startMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  waitMaintenanceTicket,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/maintenance";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  errCode,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Execute the next setup or assertion step for this scenario.
  withFlagsPatch,
  // Execute the next setup or assertion step for this scenario.
  withOperationsPatch,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
  // Execute the next setup or assertion step for this scenario.
  postJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";

// Re-export selected symbols for suite consumers.
export {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  errCode,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Execute the next setup or assertion step for this scenario.
  withFlagsPatch,
  // Execute the next setup or assertion step for this scenario.
  withOperationsPatch,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
  // Execute the next setup or assertion step for this scenario.
  postJson,
};
// Execute the next setup or assertion step for this scenario.
export type { CleaningWorld, EmployeeUserFixture };

// Export ReadinessWorld for shared test/setup consumers.
export type ReadinessWorld = CleaningWorld & {
  // Execute the next setup or assertion step for this scenario.
  commonAreaId: string;
  // Execute the next setup or assertion step for this scenario.
  supervisor: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  technician2: EmployeeUserFixture;
};

/** Cleaning world + common area + supervisor + second technician. */
export async function createReadinessWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<ReadinessWorld> {
  // base: seeded entity required before the mutation under test.
  const base = await createCleaningWorld(prisma);
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = base.stamp;

  // supervisor: seeded entity required before the mutation under test.
  const supervisor = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `RDY-SUP-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `rdy-sup-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "RDY Supervisor",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });
  // technician2: seeded entity required before the mutation under test.
  const technician2 = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `RDY-TE2-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `rdy-te2-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "RDY Technician 2",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });

  // commonArea: seeded entity required before the mutation under test.
  const commonArea = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: base.floorId,
      // Execute the next setup or assertion step for this scenario.
      number: `CA-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "common_area",
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.verified_clean,
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      serviceStatus: ServiceStatus.in_service,
    },
  });

  // Return the arranged value/result to the caller.
  return {
    // Continue the call chain for setup or assertion detail.
    ...base,
    // Execute the next setup or assertion step for this scenario.
    commonAreaId: commonArea.id,
    // Execute the next setup or assertion step for this scenario.
    supervisor,
    // Execute the next setup or assertion step for this scenario.
    technician2,
    // Execute the next setup or assertion step for this scenario.
    employeeIds: [
      // Continue the call chain for setup or assertion detail.
      ...base.employeeIds,
      // Execute the next setup or assertion step for this scenario.
      supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      technician2.employeeId,
    ],
  };
}

// Export helper cleanupReadinessWorld for reuse across related tests.
export async function cleanupReadinessWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: ReadinessWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locationIds for later setup or assertions in this scope.
  const locationIds = [
    // Execute the next setup or assertion step for this scenario.
    world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    world.locationBId,
    // Execute the next setup or assertion step for this scenario.
    world.commonAreaId,
  ];

  // Await async work before asserting or releasing locks.
  await prisma.ticketReopenEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { ticket: { locationId: { in: locationIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.ticketEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { ticket: { locationId: { in: locationIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.inspection.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: locationIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { task: { locationId: { in: locationIds } } },
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: world.employeeIds } },
      ],
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locationIds } },
  });
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanEntry.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: locationIds } },
    });
  // Execute the next setup or assertion step for this scenario.
  } catch {
    // Daily plan may be unused in some suites.
  }
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locationIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: locationIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, world.employeeIds);
}

/** Ensure room is vacant + in_service (caller sets cleaning as needed). */
export async function prepareRoomBase(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Execute the next setup or assertion step for this scenario.
  cleaningStatus: CleaningStatus = CleaningStatus.verified_clean,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Await async work before asserting or releasing locks.
  await prisma.location.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: locationId },
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      serviceStatus: ServiceStatus.in_service,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus,
      // Execute the next setup or assertion step for this scenario.
      catalogStatus: "active",
    },
  });
}

/** Active issue option from seed/catalog (required for createMaintenanceTicket). */
export async function findActiveIssueOption(prisma: PrismaClient) {
  // option: synchronize actors so the race window is observable.
  const option = await prisma.issueOption.findFirst({
    // SQL fragment used to observe locks or assert DB state.
    where: { isActive: true },
    // Execute the next setup or assertion step for this scenario.
    include: { maintenanceCategory: true },
    // Execute the next setup or assertion step for this scenario.
    orderBy: { sortOrder: "asc" },
  });
  // Assert the observed value matches the intended post-condition.
  assert.ok(option, "need at least one active issue option");
  // Return the arranged value/result to the caller.
  return option;
}

// Export BlockingTicketTarget for shared test/setup consumers.
export type BlockingTicketTarget =
  // Execute the next setup or assertion step for this scenario.
  | "new"
  // Execute the next setup or assertion step for this scenario.
  | "assigned"
  // Execute the next setup or assertion step for this scenario.
  | "in_progress"
  // Execute the next setup or assertion step for this scenario.
  | "waiting";

/**
 * Create a blocksRoom ticket and advance it to the requested open status
 * via real production service calls.
 */
export async function createBlockingTicketAtStatus(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: ReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Concurrency/isolation step for the race under test.
  target: BlockingTicketTarget,
  // Execute the next setup or assertion step for this scenario.
  assigneeId = world.technician.employeeId,
// Execute the next setup or assertion step for this scenario.
) {
  // option: synchronize actors so the race window is observable.
  const option = await findActiveIssueOption(prisma);
  // created: seeded entity required before the mutation under test.
  const created = await createMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    locationId,
    // Execute the next setup or assertion step for this scenario.
    issueOptionId: option.id,
    // Concurrency/isolation step for the race under test.
    blocksRoom: true,
    // Execute the next setup or assertion step for this scenario.
    reportedByEmployeeId: world.owner.employeeId,
    // Execute the next setup or assertion step for this scenario.
    priority: Priority.normal,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Readiness tests create multiple blockers on one room; override exact-dup gate.
    allowDuplicate: true,
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    duplicateOverrideReason: "readiness multi-blocker fixture",
  });
  // ticketId: unique stamp so parallel runs do not collide.
  const ticketId = created.ticket.id;

  // Conditional path for setup, cleanup, or alternate outcomes.
  if (target === "new") return created.ticket;

  // Await async work before asserting or releasing locks.
  await assignMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    assigneeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: world.owner.employeeId,
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (target === "assigned") {
    // Return the arranged value/result to the caller.
    return prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticketId },
    });
  }

  // Await async work before asserting or releasing locks.
  await startMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: assigneeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (target === "in_progress") {
    // Return the arranged value/result to the caller.
    return prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticketId },
    });
  }

  // Await async work before asserting or releasing locks.
  await waitMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: assigneeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
  });
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    (
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceTicket.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: ticketId },
      })
    // Execute the next setup or assertion step for this scenario.
    ).status,
    // Execute the next setup or assertion step for this scenario.
    TicketStatus.waiting,
  );
  // Return the arranged value/result to the caller.
  return prisma.maintenanceTicket.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: ticketId },
  });
}

// Export helper resolveBlockingTicket for reuse across related tests.
export async function resolveBlockingTicket(
  // Execute the next setup or assertion step for this scenario.
  ticketId: string,
  // Execute the next setup or assertion step for this scenario.
  actorEmployeeId: string,
  // Execute the next setup or assertion step for this scenario.
  notes = "rdy resolve",
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return resolveMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    resolvedByEmployeeId: actorEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    resolutionNotes: notes,
    // Execute the next setup or assertion step for this scenario.
    bypassAssigneeCheck: true,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
  });
}

/** GET /rooms/:id readiness fields via HTTP. */
export async function getRoomViaApi(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  roomId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<{
  // Fixture field status for the seeded actor/entity.
  status: number;
  // Configure body for the request/server under test.
  body: {
    // Execute the next setup or assertion step for this scenario.
    id?: string;
    // Execute the next setup or assertion step for this scenario.
    readiness?: string;
    // Execute the next setup or assertion step for this scenario.
    readinessReasons?: string[];
    // Execute the next setup or assertion step for this scenario.
    occupancy?: string;
    // Execute the next setup or assertion step for this scenario.
    cleaningStatus?: string;
    // Execute the next setup or assertion step for this scenario.
    serviceStatus?: string;
    // Execute the next setup or assertion step for this scenario.
    catalogStatus?: string;
    // Concurrency/isolation step for the race under test.
    blockingIssues?: unknown[];
  };
// Execute the next setup or assertion step for this scenario.
}> {
  // res: HTTP response captured for status/body checks.
  const res = await getJson(api, token, `/rooms/${roomId}`);
  // Return the arranged value/result to the caller.
  return {
    // Fixture field status for the seeded actor/entity.
    status: res.status,
    // Configure body for the request/server under test.
    body: (res.body ?? {}) as {
      // Execute the next setup or assertion step for this scenario.
      id?: string;
      // Execute the next setup or assertion step for this scenario.
      readiness?: string;
      // Execute the next setup or assertion step for this scenario.
      readinessReasons?: string[];
      // Execute the next setup or assertion step for this scenario.
      occupancy?: string;
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus?: string;
      // Execute the next setup or assertion step for this scenario.
      serviceStatus?: string;
      // Execute the next setup or assertion step for this scenario.
      catalogStatus?: string;
      // Concurrency/isolation step for the race under test.
      blockingIssues?: unknown[];
    },
  };
}
