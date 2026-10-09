/**
 * Smoke: ticket.start/wait/resume/resolve are idempotent by commandId.
 * Requires DB + seeded owner/technician. Does not need HTTP API.
 */
import { randomUUID } from "crypto";
import { Priority, PrismaClient, TicketStatus } from "@prisma/client";
import { AppError } from "../src/errors";
import {
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../src/services/maintenance";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function errCode(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
}

async function createAssignedTicket(input: {
  locationId: string;
  reporterId: string;
  assigneeId: string;
}) {
  const option = await prisma.issueOption.findFirst({
    where: { isActive: true },
    include: { maintenanceCategory: true },
    orderBy: { sortOrder: "asc" },
  });
  assert(option, "no active issue option");
  assert(option.maintenanceCategory, "issue option missing category");

  return prisma.maintenanceTicket.create({
    data: {
      locationId: input.locationId,
      title: `Smoke lifecycle idempotency ${Date.now()}`,
      issueOptionId: option.id,
      maintenanceCategoryId: option.maintenanceCategoryId,
      categoryKey: option.maintenanceCategory.key,
      categoryLabelBg: option.maintenanceCategory.nameBg,
      categoryLabelEn: option.maintenanceCategory.nameEn,
      priority: Priority.normal,
      blocksRoom: false,
      status: TicketStatus.assigned,
      reportedByEmployeeId: input.reporterId,
      assigneeId: input.assigneeId,
    },
  });
}

async function main() {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@meridian.local" },
  });
  const tech = await prisma.user.findUniqueOrThrow({
    where: { email: "technician@meridian.local" },
  });
  assert(owner.employeeId, "owner has no employeeId");
  assert(tech.employeeId, "technician has no employeeId");

  const room = await prisma.location.findFirst({
    where: { catalogStatus: "active", kind: "room" },
    orderBy: { number: "asc" },
  });
  assert(room, "no active room");

  const ticket = await createAssignedTicket({
    locationId: room.id,
    reporterId: owner.employeeId,
    assigneeId: tech.employeeId,
  });

  const startId = randomUUID();
  const firstStart = await startMaintenanceTicket({
    ticketId: ticket.id,
    actorEmployeeId: tech.employeeId,
    commandId: startId,
  });
  assert(firstStart.status === TicketStatus.in_progress, "start → in_progress");

  const replayStart = await startMaintenanceTicket({
    ticketId: ticket.id,
    actorEmployeeId: tech.employeeId,
    commandId: startId,
  });
  assert(
    replayStart.status === TicketStatus.in_progress,
    "replay start returns in_progress",
  );
  assert(replayStart.id === ticket.id, "replay start same ticket");

  const startEvents = await prisma.ticketEvent.count({
    where: { ticketId: ticket.id, commandId: startId },
  });
  assert(startEvents === 1, "replay start must not create a second event");

  try {
    await startMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: tech.employeeId,
      commandId: startId,
      // different actor fingerprint via different resolved notes N/A — use other employee
    });
  } catch {
    /* same payload replay already succeeded above */
  }

  // Same commandId with different actor → conflict
  let conflicted = false;
  try {
    await startMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: owner.employeeId,
      commandId: startId,
      bypassAssigneeCheck: true,
    });
  } catch (err) {
    conflicted = errCode(err) === "conflict";
  }
  assert(conflicted, "same commandId different actor must conflict");

  // True invalid transition with NEW commandId remains invalid_state
  let invalid = false;
  try {
    await startMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: tech.employeeId,
      commandId: randomUUID(),
    });
  } catch (err) {
    invalid = errCode(err) === "invalid_state";
  }
  assert(invalid, "new start while in_progress must be invalid_state");

  // Unauthorized assignee still 403 (new command)
  let forbidden = false;
  try {
    await startMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: owner.employeeId,
      commandId: randomUUID(),
    });
  } catch (err) {
    // already in_progress → invalid_state before assignee check; use a fresh assigned ticket
    forbidden = errCode(err) === "forbidden" || errCode(err) === "invalid_state";
  }
  assert(forbidden, "non-assignee start must be refused");

  const fresh = await createAssignedTicket({
    locationId: room.id,
    reporterId: owner.employeeId,
    assigneeId: tech.employeeId,
  });
  let unauthorized = false;
  try {
    await startMaintenanceTicket({
      ticketId: fresh.id,
      actorEmployeeId: owner.employeeId,
      commandId: randomUUID(),
    });
  } catch (err) {
    unauthorized = errCode(err) === "forbidden";
  }
  assert(unauthorized, "non-assignee on assigned ticket must be forbidden");

  // wait / resume / resolve idempotency on the first ticket
  const waitId = randomUUID();
  const waited = await waitMaintenanceTicket({
    ticketId: ticket.id,
    actorEmployeeId: tech.employeeId,
    reason: "parts",
    commandId: waitId,
  });
  assert(waited.status === TicketStatus.waiting, "wait → waiting");
  const waitReplay = await waitMaintenanceTicket({
    ticketId: ticket.id,
    actorEmployeeId: tech.employeeId,
    reason: "parts",
    commandId: waitId,
  });
  assert(waitReplay.status === TicketStatus.waiting, "wait replay ok");
  assert(
    (await prisma.ticketEvent.count({ where: { commandId: waitId } })) === 1,
    "wait replay single event",
  );

  let waitPayloadConflict = false;
  try {
    await waitMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: tech.employeeId,
      reason: "different",
      commandId: waitId,
    });
  } catch (err) {
    waitPayloadConflict = errCode(err) === "conflict";
  }
  assert(waitPayloadConflict, "wait same id different reason → conflict");

  const resumeId = randomUUID();
  const resumed = await resumeMaintenanceTicket({
    ticketId: ticket.id,
    actorEmployeeId: tech.employeeId,
    commandId: resumeId,
  });
  assert(resumed.status === TicketStatus.in_progress, "resume → in_progress");
  const resumeReplay = await resumeMaintenanceTicket({
    ticketId: ticket.id,
    actorEmployeeId: tech.employeeId,
    commandId: resumeId,
  });
  assert(resumeReplay.status === TicketStatus.in_progress, "resume replay ok");
  assert(
    (await prisma.ticketEvent.count({ where: { commandId: resumeId } })) === 1,
    "resume replay single event",
  );

  const resolveId = randomUUID();
  const resolved = await resolveMaintenanceTicket({
    ticketId: ticket.id,
    resolvedByEmployeeId: tech.employeeId,
    resolutionNotes: "fixed",
    commandId: resolveId,
  });
  assert(resolved.status === TicketStatus.resolved, "resolve → resolved");
  const resolveReplay = await resolveMaintenanceTicket({
    ticketId: ticket.id,
    resolvedByEmployeeId: tech.employeeId,
    resolutionNotes: "fixed",
    commandId: resolveId,
  });
  assert(resolveReplay.status === TicketStatus.resolved, "resolve replay ok");
  assert(
    (await prisma.ticketEvent.count({ where: { commandId: resolveId } })) === 1,
    "resolve replay single event",
  );

  let resolvePayloadConflict = false;
  try {
    await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: tech.employeeId,
      resolutionNotes: "other notes",
      commandId: resolveId,
    });
  } catch (err) {
    resolvePayloadConflict = errCode(err) === "conflict";
  }
  assert(resolvePayloadConflict, "resolve same id different notes → conflict");

  // Cleanup
  for (const id of [ticket.id, fresh.id]) {
    await prisma.ticketEvent.deleteMany({ where: { ticketId: id } });
    await prisma.ticketReopenEvent.deleteMany({ where: { ticketId: id } });
    await prisma.maintenanceTicket.delete({ where: { id } });
  }

  console.log("smoke-ticket-lifecycle-idempotency: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
