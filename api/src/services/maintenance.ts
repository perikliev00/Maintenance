import { createHash } from "crypto";
import { Priority, Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { OPEN_TICKET_STATUSES } from "../constants";
import { publish } from "../events/bus";
import {
  getActiveIssueOption,
  resolveCategorySnapshot,
  snapshotFromCategory,
} from "./issueCatalog";
import { recordAudit } from "./audit";
import {
  createNotifications,
  recipientsForLocationOps,
} from "./notifications";
import { assertActiveMaintenanceAssignee } from "./assignees";
import { resolveSlaForPriority } from "./slaPolicies";

export {
  ensureDefaultSlaPolicies,
  listSlaPolicies,
  upsertSlaPolicy,
} from "./slaPolicies";

function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

const ticketInclude = {
  location: { include: { floor: { include: { building: true } } } },
  reportedBy: true,
  assignee: true,
  resolvedBy: true,
  closedBy: true,
  issueOption: true,
} as const;

type TicketWithRelations = Prisma.MaintenanceTicketGetPayload<{
  include: typeof ticketInclude;
}>;

async function notifyTicketEvent(input: {
  type: string;
  title: string;
  body: string;
  ticket: TicketWithRelations;
  actorEmployeeId: string | null;
  recipientEmployeeIds: string[];
  dedupeKey: string;
}) {
  const locNum = input.ticket.location?.number;
  await createNotifications({
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: "ticket",
    entityId: input.ticket.id,
    locationId: input.ticket.locationId,
    actorEmployeeId: input.actorEmployeeId,
    recipientEmployeeIds: input.recipientEmployeeIds,
    dedupeKey: input.dedupeKey,
    payload: {
      panel: "repairs",
      ticketId: input.ticket.id,
      locationId: input.ticket.locationId,
      locationNumber: locNum,
    },
  });
}

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

type FormattedMaintenanceTicket = ReturnType<
  typeof formatMaintenanceTicket<TicketWithRelations>
>;

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

type Tx = Prisma.TransactionClient;

async function lockTicket(tx: Tx, ticketId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "MaintenanceTicket" WHERE id = ${ticketId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
}

async function loadLockedTicket(tx: Tx, ticketId: string) {
  await lockTicket(tx, ticketId);
  const ticket = await tx.maintenanceTicket.findUnique({
    where: { id: ticketId },
  });
  if (!ticket) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
  return ticket;
}

async function claimTicketUpdate(
  tx: Tx,
  ticketId: string,
  fromStatuses: TicketStatus[],
  data: Prisma.MaintenanceTicketUncheckedUpdateManyInput,
  invalidMessage: (status: TicketStatus) => string,
) {
  const claimed = await tx.maintenanceTicket.updateMany({
    where: { id: ticketId, status: { in: fromStatuses } },
    data,
  });
  if (claimed.count === 0) {
    const current = await tx.maintenanceTicket.findUnique({
      where: { id: ticketId },
    });
    if (!current) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    throw new AppError(409, "invalid_state", invalidMessage(current.status));
  }
  return tx.maintenanceTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: ticketInclude,
  });
}

type LifecycleCommandKind = "start" | "wait" | "resume" | "resolve";

type LifecycleCommandKey = {
  kind: LifecycleCommandKind;
  ticketId: string;
  actorEmployeeId: string;
  reason?: string | null;
  resolutionNotes?: string | null;
};

function lifecyclePayloadFingerprint(key: LifecycleCommandKey): string {
  const normalized = {
    kind: key.kind,
    ticketId: key.ticketId,
    actorEmployeeId: key.actorEmployeeId,
    reason: key.reason ?? null,
    resolutionNotes: key.resolutionNotes ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function readLifecycleFingerprint(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const fp = (payload as { _commandFingerprint?: unknown })._commandFingerprint;
  return typeof fp === "string" ? fp : null;
}

async function findTicketByLifecycleCommand(commandId: string) {
  const event = await prisma.ticketEvent.findUnique({
    where: { commandId },
    include: { ticket: { include: ticketInclude } },
  });
  return event;
}

function assertLifecycleCommandMatch(
  event: { ticketId: string; actorEmployeeId: string; payload: unknown },
  key: LifecycleCommandKey,
) {
  const expected = lifecyclePayloadFingerprint(key);
  const actual = readLifecycleFingerprint(event.payload);
  if (
    actual !== expected ||
    event.ticketId !== key.ticketId ||
    event.actorEmployeeId !== key.actorEmployeeId
  ) {
    throw new AppError(
      409,
      "conflict",
      "commandId reused with a different payload",
    );
  }
}

async function replayLifecycleCommand(
  commandId: string | undefined,
  key: LifecycleCommandKey,
): Promise<{ ticket: FormattedMaintenanceTicket; idempotent: true } | null> {
  if (!commandId) return null;
  const existing = await findTicketByLifecycleCommand(commandId);
  if (!existing) return null;
  assertLifecycleCommandMatch(existing, key);
  return {
    ticket: formatMaintenanceTicket(existing.ticket),
    idempotent: true,
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
    commandId?: string;
    commandKey?: LifecycleCommandKey;
  },
) {
  const payloadBase =
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? { ...(input.payload as Record<string, unknown>) }
      : {};
  const payload =
    input.commandKey != null
      ? {
          ...payloadBase,
          _commandFingerprint: lifecyclePayloadFingerprint(input.commandKey),
        }
      : input.payload;

  await tx.ticketEvent.create({
    data: {
      ticketId: input.ticketId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorEmployeeId: input.actorEmployeeId,
      reason: input.reason ?? null,
      payload: (payload as TicketEventPayload) ?? undefined,
      commandId: input.commandId ?? null,
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

  const defaultSummary = (() => {
    switch (action) {
      case "ticket.create":
        return "Created ticket";
      case "ticket.assign":
        return "Assigned ticket";
      case "ticket.start":
        return "Started ticket";
      case "ticket.wait":
        return "Ticket set to waiting";
      case "ticket.resume":
        return "Resumed ticket";
      case "ticket.resolve":
        return "Resolved ticket";
      case "ticket.close":
        return "Closed ticket";
      case "ticket.reopen":
        return "Reopened ticket";
      default:
        return `Ticket ${input.toStatus}`;
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
      summary: input.summary?.trim() || defaultSummary,
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
  {
    const opsRecipients = await recipientsForLocationOps(
      ticket.locationId,
      "tickets.assign",
    );
    const liveRecipients =
      priority === Priority.urgent || blocksRoom
        ? await recipientsForLocationOps(
            ticket.locationId,
            "operations.view_live",
          )
        : [];
    const recipients = [...new Set([...opsRecipients, ...liveRecipients])];
    const locNum = ticket.location?.number ?? "?";
    const urgency =
      priority === Priority.urgent || blocksRoom
        ? priority === Priority.urgent && blocksRoom
          ? "Urgent blocking ticket"
          : priority === Priority.urgent
            ? "Urgent ticket"
            : "Blocking ticket"
        : "New ticket";
    await notifyTicketEvent({
      type: "ticket.created",
      title: urgency,
      body: `${locNum}: ${ticket.title}`,
      ticket,
      actorEmployeeId: input.reportedByEmployeeId,
      recipientEmployeeIds: recipients,
      dedupeKey: `ticket.created:${ticket.id}`,
    });
  }
  return { ticket: formatMaintenanceTicket(ticket), idempotent: false };
}

export async function assignMaintenanceTicket(input: {
  ticketId: string;
  assigneeId: string;
  actorEmployeeId: string;
}) {
  await assertActiveMaintenanceAssignee(input.assigneeId);

  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await loadLockedTicket(tx, input.ticketId);
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
    const row = await claimTicketUpdate(
      tx,
      ticket.id,
      [TicketStatus.new, TicketStatus.assigned],
      {
        status: TicketStatus.assigned,
        assigneeId: input.assigneeId,
      },
      (status) => `Cannot assign ticket in status ${status}`,
    );

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
  await notifyTicketEvent({
    type: "ticket.assigned",
    title: "Ticket assigned to you",
    body: `${updated.location?.number ?? "?"}: ${updated.title}`,
    ticket: updated,
    actorEmployeeId: input.actorEmployeeId,
    recipientEmployeeIds: [input.assigneeId],
    dedupeKey: `ticket.assigned:${updated.id}:${input.assigneeId}`,
  });
  return formatMaintenanceTicket(updated);
}

export async function startMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const commandKey: LifecycleCommandKey = {
    kind: "start",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
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
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.assigned],
        { status: TicketStatus.in_progress },
        (status) => `Cannot start ticket in status ${status}`,
      );

      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.in_progress,
        actorEmployeeId: input.actorEmployeeId,
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
    if (updated.assigneeId) {
      await notifyTicketEvent({
        type: "ticket.started",
        title: "Ticket started",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.actorEmployeeId,
        recipientEmployeeIds: [updated.assigneeId],
        dedupeKey: `ticket.started:${updated.id}:${updated.status}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function waitMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  reason?: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const reason = input.reason?.trim() || null;
  const commandKey: LifecycleCommandKey = {
    kind: "wait",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
    reason,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
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

      const fromStatus = ticket.status;
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.in_progress],
        {
          status: TicketStatus.waiting,
          ...pauseFieldsOnWait(),
        },
        (status) => `Cannot wait ticket in status ${status}`,
      );

      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.waiting,
        actorEmployeeId: input.actorEmployeeId,
        reason,
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
    if (updated.assigneeId) {
      await notifyTicketEvent({
        type: "ticket.waiting",
        title: "Ticket waiting",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.actorEmployeeId,
        recipientEmployeeIds: [updated.assigneeId],
        dedupeKey: `ticket.waiting:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function resumeMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const commandKey: LifecycleCommandKey = {
    kind: "resume",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
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
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.waiting],
        {
          status: TicketStatus.in_progress,
          ...unpaused,
        },
        (status) => `Cannot resume ticket in status ${status}`,
      );

      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.in_progress,
        actorEmployeeId: input.actorEmployeeId,
        payload: { resumed: true },
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
    if (updated.assigneeId) {
      await notifyTicketEvent({
        type: "ticket.resumed",
        title: "Ticket resumed",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.actorEmployeeId,
        recipientEmployeeIds: [updated.assigneeId],
        dedupeKey: `ticket.resumed:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function resolveMaintenanceTicket(input: {
  ticketId: string;
  resolvedByEmployeeId: string;
  resolutionNotes?: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const notes = input.resolutionNotes?.trim() || null;
  const commandKey: LifecycleCommandKey = {
    kind: "resolve",
    ticketId: input.ticketId,
    actorEmployeeId: input.resolvedByEmployeeId,
    resolutionNotes: notes,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
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

      const fromStatus = ticket.status;
      const unpaused =
        ticket.status === TicketStatus.waiting
          ? unpauseFields(ticket)
          : {
              slaPausedAt: null,
              slaPausedMsTotal: ticket.slaPausedMsTotal,
              dueAt: ticket.dueAt,
            };

      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.in_progress, TicketStatus.waiting],
        {
          status: TicketStatus.resolved,
          resolvedAt: new Date(),
          resolvedByEmployeeId: input.resolvedByEmployeeId,
          resolutionNotes: notes,
          ...unpaused,
        },
        (status) => `Cannot resolve ticket in status ${status}`,
      );

      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.resolved,
        actorEmployeeId: input.resolvedByEmployeeId,
        reason: notes,
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
    {
      const recipients = [
        updated.assigneeId,
        updated.reportedByEmployeeId,
      ].filter((id): id is string => Boolean(id));
      await notifyTicketEvent({
        type: "ticket.resolved",
        title: "Ticket resolved",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.resolvedByEmployeeId,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.resolved:${updated.id}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function closeMaintenanceTicket(input: {
  ticketId: string;
  closedByEmployeeId: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await loadLockedTicket(tx, input.ticketId);
    if (ticket.status !== TicketStatus.resolved) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot close ticket in status ${ticket.status}`,
      );
    }

    const fromStatus = ticket.status;
    const row = await claimTicketUpdate(
      tx,
      ticket.id,
      [TicketStatus.resolved],
      {
        status: TicketStatus.closed,
        closedAt: new Date(),
        closedByEmployeeId: input.closedByEmployeeId,
      },
      (status) => `Cannot close ticket in status ${status}`,
    );

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
  {
    const recipients = [
      updated.assigneeId,
      updated.reportedByEmployeeId,
    ].filter((id): id is string => Boolean(id));
    await notifyTicketEvent({
      type: "ticket.closed",
      title: "Ticket closed",
      body: `${updated.location?.number ?? "?"}: ${updated.title}`,
      ticket: updated,
      actorEmployeeId: input.closedByEmployeeId,
      recipientEmployeeIds: recipients,
      dedupeKey: `ticket.closed:${updated.id}`,
    });
  }
  return formatMaintenanceTicket(updated);
}

export async function reopenMaintenanceTicket(input: {
  ticketId: string;
  reopenedByEmployeeId: string;
  reason?: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await loadLockedTicket(tx, input.ticketId);
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

    const row = await claimTicketUpdate(
      tx,
      ticket.id,
      [TicketStatus.resolved, TicketStatus.closed],
      {
        status: TicketStatus.in_progress,
        resolvedAt: null,
        resolvedByEmployeeId: null,
        resolutionNotes: null,
        closedAt: null,
        closedByEmployeeId: null,
        slaPausedAt: null,
      },
      () => "Only resolved or closed tickets can be reopened",
    );

    await tx.ticketReopenEvent.create({
      data: {
        ticketId: ticket.id,
        reopenedByEmployeeId: input.reopenedByEmployeeId,
        reason,
        previousStatus: fromStatus,
      },
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
  {
    const recipients = [
      updated.assigneeId,
      updated.reportedByEmployeeId,
    ].filter((id): id is string => Boolean(id));
    await notifyTicketEvent({
      type: "ticket.reopened",
      title: "Ticket reopened",
      body: `${updated.location?.number ?? "?"}: ${updated.title}`,
      ticket: updated,
      actorEmployeeId: input.reopenedByEmployeeId,
      recipientEmployeeIds: recipients,
      dedupeKey: `ticket.reopened:${updated.id}:${updated.updatedAt.toISOString()}`,
    });
  }
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

