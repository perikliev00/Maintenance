import { Priority, Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "./cleaning";
import { OPEN_TICKET_STATUSES } from "../constants";
import { publish } from "../events/bus";
import { getOperations } from "./settings";
import {
  getActiveIssueOption,
  resolveCategorySnapshot,
  snapshotFromCategory,
} from "./issueCatalog";
import { recordAudit } from "./audit";

const ticketInclude = {
  location: { include: { floor: { include: { building: true } } } },
  reportedBy: true,
  assignee: true,
  resolvedBy: true,
  closedBy: true,
  issueOption: true,
} as const;

export type CreateMaintenanceTicketInput = {
  locationId: string;
  title?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: Priority;
  blocksRoom: boolean;
  reportedByEmployeeId: string;
  commandId?: string;
  dueAt?: Date;
};

type TicketEventPayload = Prisma.InputJsonValue | undefined;

function publishTicketChanged(ticket: { locationId: string; id: string }) {
  publish("ticket.changed", {
    locationId: ticket.locationId,
    ticketId: ticket.id,
  });
}

export function formatMaintenanceTicket<
  T extends { categoryKey: string; categoryLabelBg: string; categoryLabelEn: string },
>(ticket: T) {
  return {
    ...ticket,
    category: ticket.categoryKey,
  };
}

async function resolveSlaForPriority(priority: Priority) {
  const policy = await prisma.slaPolicy.findFirst({
    where: { priority, isActive: true },
  });
  if (policy) {
    return { policyId: policy.id, hours: policy.hours };
  }
  const ops = await getOperations();
  return { policyId: null as string | null, hours: ops.defaultTicketSlaHours };
}

function pauseFieldsOnWait(now = new Date()) {
  return { slaPausedAt: now };
}

function unpauseFields(
  ticket: { dueAt: Date | null; slaPausedAt: Date | null; slaPausedMsTotal: number },
  now = new Date(),
) {
  if (!ticket.slaPausedAt) {
    return {
      slaPausedAt: null,
      slaPausedMsTotal: ticket.slaPausedMsTotal,
      dueAt: ticket.dueAt,
    };
  }
  const pausedMs = Math.max(0, now.getTime() - ticket.slaPausedAt.getTime());
  const dueAt =
    ticket.dueAt != null
      ? new Date(ticket.dueAt.getTime() + pausedMs)
      : ticket.dueAt;
  return {
    slaPausedAt: null,
    slaPausedMsTotal: ticket.slaPausedMsTotal + pausedMs,
    dueAt,
  };
}

async function writeTicketEvent(
  tx: Prisma.TransactionClient,
  input: {
    ticketId: string;
    locationId?: string;
    fromStatus: TicketStatus | null;
    toStatus: TicketStatus;
    actorEmployeeId: string;
    reason?: string | null;
    payload?: TicketEventPayload;
    action?: string;
    summary?: string;
  },
) {
  await tx.ticketEvent.create({
    data: {
      ticketId: input.ticketId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorEmployeeId: input.actorEmployeeId,
      reason: input.reason ?? null,
      payload: input.payload ?? undefined,
    },
  });

  const action =
    input.action ??
    (() => {
      const payload =
        input.payload && typeof input.payload === "object" && input.payload !== null
          ? (input.payload as Record<string, unknown>)
          : {};
      if (payload.reopen) return "ticket.reopen";
      if (payload.resumed) return "ticket.resume";
      switch (input.toStatus) {
        case TicketStatus.new:
          return "ticket.create";
        case TicketStatus.assigned:
          return "ticket.assign";
        case TicketStatus.in_progress:
          return "ticket.start";
        case TicketStatus.waiting:
          return "ticket.wait";
        case TicketStatus.resolved:
          return "ticket.resolve";
        case TicketStatus.closed:
          return "ticket.close";
        default:
          return `ticket.${input.toStatus}`;
      }
    })();

  await recordAudit(
    {
      actorEmployeeId: input.actorEmployeeId,
      action,
      entityType: "ticket",
      entityId: input.ticketId,
      locationId: input.locationId,
      reason: input.reason,
      before: input.fromStatus ? { status: input.fromStatus } : null,
      after: {
        status: input.toStatus,
        ...(input.payload && typeof input.payload === "object"
          ? (input.payload as object)
          : {}),
      },
      summary: input.summary,
    },
    tx,
  );
}

export async function createMaintenanceTicket(input: CreateMaintenanceTicketInput) {
  if (input.commandId) {
    const existing = await prisma.maintenanceTicket.findUnique({
      where: { commandId: input.commandId },
      include: ticketInclude,
    });
    if (existing) {
      return { ticket: formatMaintenanceTicket(existing), idempotent: true };
    }
  }

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }

  if (input.issueOptionId && input.categoryId) {
    throw new AppError(
      400,
      "validation",
      "Provide either issueOptionId or categoryId, not both",
    );
  }
  if (!input.issueOptionId && !input.categoryId) {
    throw new AppError(
      400,
      "validation",
      "issueOptionId or categoryId is required",
    );
  }

  let title = input.title?.trim() ?? "";
  let priority = input.priority ?? Priority.normal;
  const blocksRoom = input.blocksRoom;
  let issueOptionId: string | null = null;
  let snapshot;

  if (input.issueOptionId) {
    const option = await getActiveIssueOption(input.issueOptionId);
    issueOptionId = option.id;
    snapshot = snapshotFromCategory(option.maintenanceCategory);
    if (!title) {
      title = option.nameBg;
    }
    if (input.priority === undefined && option.defaultPriority) {
      priority = option.defaultPriority;
    }
  } else {
    snapshot = await resolveCategorySnapshot(input.categoryId!, true);
  }

  if (!title) {
    throw new AppError(400, "validation", "title is required");
  }

  const sla = await resolveSlaForPriority(priority);
  let dueAt = input.dueAt ?? null;
  if (!dueAt) {
    dueAt = new Date(Date.now() + sla.hours * 60 * 60 * 1000);
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceTicket.create({
      data: {
        locationId: input.locationId,
        title,
        issueOptionId,
        maintenanceCategoryId: snapshot.maintenanceCategoryId,
        categoryKey: snapshot.categoryKey,
        categoryLabelBg: snapshot.categoryLabelBg,
        categoryLabelEn: snapshot.categoryLabelEn,
        priority,
        blocksRoom,
        status: TicketStatus.new,
        reportedByEmployeeId: input.reportedByEmployeeId,
        commandId: input.commandId,
        dueAt,
        slaPolicyId: sla.policyId,
        slaHoursSnapshot: sla.hours,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: created.id,
      locationId: created.locationId,
      fromStatus: null,
      toStatus: TicketStatus.new,
      actorEmployeeId: input.reportedByEmployeeId,
      payload: { priority, blocksRoom },
    });

    return created;
  });

  publishTicketChanged(ticket);
  return { ticket: formatMaintenanceTicket(ticket), idempotent: false };
}

export async function assignMaintenanceTicket(input: {
  ticketId: string;
  assigneeId: string;
  actorEmployeeId: string;
}) {
  const assignee = await prisma.employee.findUnique({
    where: { id: input.assigneeId },
  });
  if (!assignee) {
    throw new AppError(404, "not_found", "Assignee not found");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (
      ticket.status !== TicketStatus.new &&
      ticket.status !== TicketStatus.assigned
    ) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot assign ticket in status ${ticket.status}`,
      );
    }

    const fromStatus = ticket.status;
    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.assigned,
        assigneeId: input.assigneeId,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.assigned,
      actorEmployeeId: input.actorEmployeeId,
      payload: { assigneeId: input.assigneeId },
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function startMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (ticket.status !== TicketStatus.assigned) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot start ticket in status ${ticket.status}`,
      );
    }
    if (!ticket.assigneeId) {
      throw new AppError(409, "invalid_state", "Ticket has no assignee");
    }
    if (
      !input.bypassAssigneeCheck &&
      ticket.assigneeId !== input.actorEmployeeId
    ) {
      throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
    }

    const fromStatus = ticket.status;
    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: { status: TicketStatus.in_progress },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.in_progress,
      actorEmployeeId: input.actorEmployeeId,
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function waitMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  reason?: string;
  bypassAssigneeCheck?: boolean;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (ticket.status !== TicketStatus.in_progress) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot wait ticket in status ${ticket.status}`,
      );
    }
    if (
      !input.bypassAssigneeCheck &&
      ticket.assigneeId &&
      ticket.assigneeId !== input.actorEmployeeId
    ) {
      throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
    }

    const reason = input.reason?.trim() || null;
    const fromStatus = ticket.status;
    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.waiting,
        ...pauseFieldsOnWait(),
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.waiting,
      actorEmployeeId: input.actorEmployeeId,
      reason,
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function resumeMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (ticket.status !== TicketStatus.waiting) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot resume ticket in status ${ticket.status}`,
      );
    }
    if (
      !input.bypassAssigneeCheck &&
      ticket.assigneeId &&
      ticket.assigneeId !== input.actorEmployeeId
    ) {
      throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
    }

    const fromStatus = ticket.status;
    const unpaused = unpauseFields(ticket);
    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.in_progress,
        ...unpaused,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.in_progress,
      actorEmployeeId: input.actorEmployeeId,
      payload: { resumed: true },
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function resolveMaintenanceTicket(input: {
  ticketId: string;
  resolvedByEmployeeId: string;
  resolutionNotes?: string;
  bypassAssigneeCheck?: boolean;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (
      ticket.status !== TicketStatus.in_progress &&
      ticket.status !== TicketStatus.waiting
    ) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot resolve ticket in status ${ticket.status}`,
      );
    }
    if (
      !input.bypassAssigneeCheck &&
      ticket.assigneeId &&
      ticket.assigneeId !== input.resolvedByEmployeeId
    ) {
      throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
    }

    const notes = input.resolutionNotes?.trim() || null;
    const fromStatus = ticket.status;
    const unpaused =
      ticket.status === TicketStatus.waiting
        ? unpauseFields(ticket)
        : {
            slaPausedAt: null,
            slaPausedMsTotal: ticket.slaPausedMsTotal,
            dueAt: ticket.dueAt,
          };

    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.resolved,
        resolvedAt: new Date(),
        resolvedByEmployeeId: input.resolvedByEmployeeId,
        resolutionNotes: notes,
        ...unpaused,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.resolved,
      actorEmployeeId: input.resolvedByEmployeeId,
      reason: notes,
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function closeMaintenanceTicket(input: {
  ticketId: string;
  closedByEmployeeId: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (ticket.status !== TicketStatus.resolved) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot close ticket in status ${ticket.status}`,
      );
    }

    const fromStatus = ticket.status;
    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.closed,
        closedAt: new Date(),
        closedByEmployeeId: input.closedByEmployeeId,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.closed,
      actorEmployeeId: input.closedByEmployeeId,
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function reopenMaintenanceTicket(input: {
  ticketId: string;
  reopenedByEmployeeId: string;
  reason?: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
    });
    if (!ticket) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    if (
      ticket.status !== TicketStatus.resolved &&
      ticket.status !== TicketStatus.closed
    ) {
      throw new AppError(
        409,
        "invalid_state",
        "Only resolved or closed tickets can be reopened",
      );
    }

    const reason = input.reason?.trim() || null;
    const fromStatus = ticket.status;

    await tx.ticketReopenEvent.create({
      data: {
        ticketId: ticket.id,
        reopenedByEmployeeId: input.reopenedByEmployeeId,
        reason,
        previousStatus: ticket.status,
      },
    });

    const row = await tx.maintenanceTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.in_progress,
        resolvedAt: null,
        resolvedByEmployeeId: null,
        resolutionNotes: null,
        closedAt: null,
        closedByEmployeeId: null,
        slaPausedAt: null,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.in_progress,
      actorEmployeeId: input.reopenedByEmployeeId,
      reason,
      payload: { reopen: true },
    });

    return row;
  });

  publishTicketChanged(updated);
  return formatMaintenanceTicket(updated);
}

export async function listMaintenanceTickets(filters: {
  locationId?: string;
  assigneeId?: string;
  openOnly?: boolean;
  resolvedOnly?: boolean;
  statuses?: TicketStatus[];
  priority?: Priority;
  slaBreached?: boolean;
  blocksRoom?: boolean;
  limit?: number;
  scopeWhere?: Prisma.MaintenanceTicketWhereInput;
}) {
  const now = new Date();
  const rows = await prisma.maintenanceTicket.findMany({
    where: {
      AND: [
        filters.scopeWhere ?? {},
        {
          ...(filters.locationId ? { locationId: filters.locationId } : {}),
          ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
          ...(filters.statuses?.length
            ? { status: { in: filters.statuses } }
            : filters.openOnly
              ? { status: { in: [...OPEN_TICKET_STATUSES] } }
              : {}),
          ...(filters.resolvedOnly
            ? { status: { in: [TicketStatus.resolved, TicketStatus.closed] } }
            : {}),
          ...(filters.priority ? { priority: filters.priority } : {}),
          ...(filters.blocksRoom !== undefined
            ? { blocksRoom: filters.blocksRoom }
            : {}),
          ...(filters.slaBreached
            ? {
                dueAt: { lt: now },
                slaPausedAt: null,
                status: { in: [...OPEN_TICKET_STATUSES] },
              }
            : {}),
        },
      ],
    },
    include: ticketInclude,
    orderBy: filters.resolvedOnly
      ? { resolvedAt: "desc" }
      : { openedAt: "desc" },
    ...(filters.limit ? { take: filters.limit } : {}),
  });
  return rows.map((row) => {
    const formatted = formatMaintenanceTicket(row);
    const slaBreached =
      row.dueAt != null &&
      row.slaPausedAt == null &&
      OPEN_TICKET_STATUSES.includes(row.status) &&
      row.dueAt.getTime() < now.getTime();
    return { ...formatted, slaBreached };
  });
}

export async function listTicketEvents(ticketId: string) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
  return prisma.ticketEvent.findMany({
    where: { ticketId },
    include: {
      actor: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
    orderBy: { occurredAt: "asc" },
  });
}

export async function listSlaPolicies() {
  return prisma.slaPolicy.findMany({
    orderBy: { priority: "asc" },
  });
}

export async function upsertSlaPolicy(input: {
  priority: Priority;
  hours: number;
  isActive?: boolean;
  actorEmployeeId?: string;
}) {
  if (input.hours < 1 || input.hours > 168) {
    throw new AppError(400, "validation", "hours must be between 1 and 168");
  }
  const existing = await prisma.slaPolicy.findUnique({
    where: { priority: input.priority },
  });
  const row = await prisma.slaPolicy.upsert({
    where: { priority: input.priority },
    create: {
      priority: input.priority,
      hours: input.hours,
      isActive: input.isActive ?? true,
    },
    update: {
      hours: input.hours,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  await recordAudit({
    actorEmployeeId: input.actorEmployeeId,
    action: "sla_policy.upsert",
    entityType: "sla_policy",
    entityId: row.id,
    before: existing
      ? { hours: existing.hours, isActive: existing.isActive }
      : null,
    after: { priority: row.priority, hours: row.hours, isActive: row.isActive },
    summary: `Updated SLA for ${row.priority} to ${row.hours}h`,
  });
  return row;
}

export async function ensureDefaultSlaPolicies() {
  const defaults: Array<{ priority: Priority; hours: number }> = [
    { priority: Priority.low, hours: 72 },
    { priority: Priority.normal, hours: 24 },
    { priority: Priority.high, hours: 8 },
    { priority: Priority.urgent, hours: 4 },
  ];
  for (const d of defaults) {
    await prisma.slaPolicy.upsert({
      where: { priority: d.priority },
      create: { priority: d.priority, hours: d.hours, isActive: true },
      update: {},
    });
  }
  return listSlaPolicies();
}
