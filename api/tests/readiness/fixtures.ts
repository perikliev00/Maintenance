/**
 * Shared world + helpers for readiness / archive / occupancy integration tests
 * (P1-31…P1-36). Lives under api/tests/readiness/ (outside parallel npm test glob).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import {
  CleaningStatus,
  Occupancy,
  Priority,
  PrismaClient,
  Role,
  ServiceStatus,
  TicketStatus,
} from "@prisma/client";
import {
  assignMaintenanceTicket,
  createMaintenanceTicket,
  resolveMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../src/services/maintenance";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createCleaningWorld,
  errCode,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  withFlagsPatch,
  withOperationsPatch,
  type CleaningWorld,
} from "../cleaning/fixtures";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  patchJson,
  postJson,
} from "../httpHarness";

export {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createCleaningWorld,
  errCode,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  withFlagsPatch,
  withOperationsPatch,
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  patchJson,
  postJson,
};
export type { CleaningWorld, EmployeeUserFixture };

export type ReadinessWorld = CleaningWorld & {
  commonAreaId: string;
  supervisor: EmployeeUserFixture;
  technician2: EmployeeUserFixture;
};

/** Cleaning world + common area + supervisor + second technician. */
export async function createReadinessWorld(
  prisma: PrismaClient,
): Promise<ReadinessWorld> {
  const base = await createCleaningWorld(prisma);
  const stamp = base.stamp;

  const supervisor = await createEmployeeWithUser(prisma, {
    employeeNumber: `RDY-SUP-${stamp}`.slice(0, 32),
    email: `rdy-sup-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "RDY Supervisor",
    password: CLN_PASSWORD,
  });
  const technician2 = await createEmployeeWithUser(prisma, {
    employeeNumber: `RDY-TE2-${stamp}`.slice(0, 32),
    email: `rdy-te2-${stamp}@test.local`,
    role: Role.technician,
    fullName: "RDY Technician 2",
    password: CLN_PASSWORD,
  });

  const commonArea = await prisma.location.create({
    data: {
      floorId: base.floorId,
      number: `CA-${stamp}`.slice(0, 24),
      kind: "common_area",
      cleaningStatus: CleaningStatus.verified_clean,
      occupancy: Occupancy.vacant,
      serviceStatus: ServiceStatus.in_service,
    },
  });

  return {
    ...base,
    commonAreaId: commonArea.id,
    supervisor,
    technician2,
    employeeIds: [
      ...base.employeeIds,
      supervisor.employeeId,
      technician2.employeeId,
    ],
  };
}

export async function cleanupReadinessWorld(
  prisma: PrismaClient,
  world: ReadinessWorld,
): Promise<void> {
  const locationIds = [
    world.locationAId,
    world.locationBId,
    world.commonAreaId,
  ];

  await prisma.ticketReopenEvent.deleteMany({
    where: { ticket: { locationId: { in: locationIds } } },
  });
  await prisma.ticketEvent.deleteMany({
    where: { ticket: { locationId: { in: locationIds } } },
  });
  await prisma.inspection.deleteMany({
    where: { task: { locationId: { in: locationIds } } },
  });
  await prisma.cleaningSession.deleteMany({
    where: {
      OR: [
        { task: { locationId: { in: locationIds } } },
        { employeeId: { in: world.employeeIds } },
      ],
    },
  });
  await prisma.cleaningTask.deleteMany({
    where: { locationId: { in: locationIds } },
  });
  try {
    await prisma.dailyPlanEntry.deleteMany({
      where: { locationId: { in: locationIds } },
    });
  } catch {
    // Daily plan may be unused in some suites.
  }
  await prisma.maintenanceTicket.deleteMany({
    where: { locationId: { in: locationIds } },
  });
  await prisma.location.deleteMany({
    where: { id: { in: locationIds } },
  });
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  await cleanupEmployeeGraph(prisma, world.employeeIds);
}

/** Ensure room is vacant + in_service (caller sets cleaning as needed). */
export async function prepareRoomBase(
  prisma: PrismaClient,
  locationId: string,
  cleaningStatus: CleaningStatus = CleaningStatus.verified_clean,
): Promise<void> {
  await prisma.location.update({
    where: { id: locationId },
    data: {
      occupancy: Occupancy.vacant,
      serviceStatus: ServiceStatus.in_service,
      cleaningStatus,
      catalogStatus: "active",
    },
  });
}

/** Active issue option from seed/catalog (required for createMaintenanceTicket). */
export async function findActiveIssueOption(prisma: PrismaClient) {
  const option = await prisma.issueOption.findFirst({
    where: { isActive: true },
    include: { maintenanceCategory: true },
    orderBy: { sortOrder: "asc" },
  });
  assert.ok(option, "need at least one active issue option");
  return option;
}

export type BlockingTicketTarget =
  | "new"
  | "assigned"
  | "in_progress"
  | "waiting";

/**
 * Create a blocksRoom ticket and advance it to the requested open status
 * via real production service calls.
 */
export async function createBlockingTicketAtStatus(
  prisma: PrismaClient,
  world: ReadinessWorld,
  locationId: string,
  target: BlockingTicketTarget,
  assigneeId = world.technician.employeeId,
) {
  const option = await findActiveIssueOption(prisma);
  const created = await createMaintenanceTicket({
    locationId,
    issueOptionId: option.id,
    blocksRoom: true,
    reportedByEmployeeId: world.owner.employeeId,
    priority: Priority.normal,
    commandId: randomUUID(),
    // Readiness tests create multiple blockers on one room; override exact-dup gate.
    allowDuplicate: true,
    duplicateOverrideReason: "readiness multi-blocker fixture",
  });
  const ticketId = created.ticket.id;

  if (target === "new") return created.ticket;

  await assignMaintenanceTicket({
    ticketId,
    assigneeId,
    actorEmployeeId: world.owner.employeeId,
  });
  if (target === "assigned") {
    return prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });
  }

  await startMaintenanceTicket({
    ticketId,
    actorEmployeeId: assigneeId,
    commandId: randomUUID(),
  });
  if (target === "in_progress") {
    return prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });
  }

  await waitMaintenanceTicket({
    ticketId,
    actorEmployeeId: assigneeId,
    commandId: randomUUID(),
  });
  assert.equal(
    (
      await prisma.maintenanceTicket.findUniqueOrThrow({
        where: { id: ticketId },
      })
    ).status,
    TicketStatus.waiting,
  );
  return prisma.maintenanceTicket.findUniqueOrThrow({
    where: { id: ticketId },
  });
}

export async function resolveBlockingTicket(
  ticketId: string,
  actorEmployeeId: string,
  notes = "rdy resolve",
) {
  return resolveMaintenanceTicket({
    ticketId,
    resolvedByEmployeeId: actorEmployeeId,
    resolutionNotes: notes,
    bypassAssigneeCheck: true,
    commandId: randomUUID(),
  });
}

/** GET /rooms/:id readiness fields via HTTP. */
export async function getRoomViaApi(
  api: string,
  token: string,
  roomId: string,
): Promise<{
  status: number;
  body: {
    id?: string;
    readiness?: string;
    readinessReasons?: string[];
    occupancy?: string;
    cleaningStatus?: string;
    serviceStatus?: string;
    catalogStatus?: string;
    blockingIssues?: unknown[];
  };
}> {
  const res = await getJson(api, token, `/rooms/${roomId}`);
  return {
    status: res.status,
    body: (res.body ?? {}) as {
      id?: string;
      readiness?: string;
      readinessReasons?: string[];
      occupancy?: string;
      cleaningStatus?: string;
      serviceStatus?: string;
      catalogStatus?: string;
      blockingIssues?: unknown[];
    },
  };
}
