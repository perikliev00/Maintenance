import { TicketStatus } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "./cleaning";
import { OPEN_TICKET_STATUSES } from "../constants";

export async function createMaintenanceTicket(input: {
  locationId: string;
  title: string;
  category: "climate" | "electrical" | "furniture" | "plumbing" | "other";
  priority?: "low" | "normal" | "high" | "urgent";
  blocksRoom: boolean;
  reportedByEmployeeId: string;
  commandId?: string;
}) {
  if (input.commandId) {
    const existing = await prisma.maintenanceTicket.findUnique({
      where: { commandId: input.commandId },
      include: {
        location: { include: { floor: { include: { building: true } } } },
        reportedBy: true,
      },
    });
    if (existing) {
      return { ticket: existing, idempotent: true };
    }
  }

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }

  const ticket = await prisma.maintenanceTicket.create({
    data: {
      locationId: input.locationId,
      title: input.title.trim(),
      category: input.category,
      priority: input.priority ?? "normal",
      blocksRoom: input.blocksRoom,
      status: TicketStatus.new,
      reportedByEmployeeId: input.reportedByEmployeeId,
      commandId: input.commandId,
    },
    include: {
      location: { include: { floor: { include: { building: true } } } },
      reportedBy: true,
      resolvedBy: true,
    },
  });

  return { ticket, idempotent: false };
}

export async function resolveMaintenanceTicket(input: {
  ticketId: string;
  resolvedByEmployeeId: string;
  resolutionNotes?: string;
}) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: input.ticketId },
  });
  if (!ticket) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
  if (
    ticket.status === TicketStatus.resolved ||
    ticket.status === TicketStatus.closed
  ) {
    throw new AppError(409, "invalid_state", "Ticket already resolved");
  }

  const notes = input.resolutionNotes?.trim() || null;

  return prisma.maintenanceTicket.update({
    where: { id: input.ticketId },
    data: {
      status: TicketStatus.resolved,
      resolvedAt: new Date(),
      resolvedByEmployeeId: input.resolvedByEmployeeId,
      resolutionNotes: notes,
    },
    include: {
      location: { include: { floor: { include: { building: true } } } },
      reportedBy: true,
      resolvedBy: true,
    },
  });
}

export async function listMaintenanceTickets(filters: {
  locationId?: string;
  openOnly?: boolean;
  resolvedOnly?: boolean;
  limit?: number;
}) {
  return prisma.maintenanceTicket.findMany({
    where: {
      ...(filters.locationId ? { locationId: filters.locationId } : {}),
      ...(filters.openOnly
        ? { status: { in: [...OPEN_TICKET_STATUSES] } }
        : {}),
      ...(filters.resolvedOnly
        ? { status: { in: [TicketStatus.resolved, TicketStatus.closed] } }
        : {}),
    },
    include: {
      location: { include: { floor: { include: { building: true } } } },
      reportedBy: true,
      resolvedBy: true,
    },
    orderBy: filters.resolvedOnly
      ? { resolvedAt: "desc" }
      : { openedAt: "desc" },
    ...(filters.limit ? { take: filters.limit } : {}),
  });
}
