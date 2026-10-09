import { Priority, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import type { AuthUser } from "../middleware/auth";
import { canPerform } from "./roleGrants";
import {
  completeCleaningSession,
  startCleaningTask,
  type TaskConflictDetails,
} from "./cleaning";
import {
  assertCanAccessLocation,
  assertCanAccessSession,
  assertCanAccessTicket,
  assertCanAccessTask,
  resolveDataScope,
} from "./dataScope";
import {
  createMaintenanceTicket,
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "./maintenance";
import { getMyWork } from "./myWork";
import { recordAudit } from "./audit";

export type SyncCommand = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  clientTime?: string;
};

export type SyncCommandResult = {
  commandId: string;
  status: "ok" | "conflict" | "forbidden" | "error";
  message?: string;
  code?: string;
  details?: unknown;
  data?: unknown;
};

async function taskSnapshotDetails(
  taskId: string,
  expectedVersion?: number,
): Promise<TaskConflictDetails | undefined> {
  const task = await prisma.cleaningTask.findUnique({
    where: { id: taskId },
    select: {
      version: true,
      status: true,
      assignedEmployeeId: true,
    },
  });
  if (!task) return undefined;
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    currentVersion: task.version,
    status: task.status,
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

async function sessionTaskSnapshotDetails(
  sessionId: string,
  expectedVersion?: number,
): Promise<TaskConflictDetails | undefined> {
  const session = await prisma.cleaningSession.findUnique({
    where: { id: sessionId },
    select: { taskId: true },
  });
  if (!session) return undefined;
  return taskSnapshotDetails(session.taskId, expectedVersion);
}

/** Build a sync conflict result for access loss after reassignment. */
export function accessLossConflictResult(
  commandId: string,
  details: TaskConflictDetails | undefined,
  fallbackMessage: string,
): SyncCommandResult {
  return {
    commandId,
    status: "conflict",
    code: details ? "assignee_conflict" : "out_of_scope",
    message: details
      ? "Task was reassigned to another employee"
      : fallbackMessage,
    details,
  };
}

/**
 * Access loss after reassignment is a conflict for offline sync, not a bare
 * permission denial. True "missing action" denials stay forbidden.
 */
async function conflictFromAccessLoss(
  cmd: SyncCommand,
  err: AppError,
  expectedVersion?: number,
): Promise<SyncCommandResult | null> {
  if (err.status !== 403) return null;
  if (cmd.type === "cleaning.start") {
    const taskId = String(cmd.payload.taskId ?? "");
    const details = await taskSnapshotDetails(taskId, expectedVersion);
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  if (cmd.type === "cleaning.complete") {
    const sessionId = String(cmd.payload.sessionId ?? "");
    const details = await sessionTaskSnapshotDetails(
      sessionId,
      expectedVersion,
    );
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  return null;
}

async function applyCommand(
  user: AuthUser,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  try {
    const scope = await resolveDataScope(user);

    switch (cmd.type) {
      case "cleaning.start": {
        if (!(await canPerform(user.role, "cleaning.start"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing cleaning.start",
          };
        }
        const taskId = String(cmd.payload.taskId ?? "");
        const expectedVersion =
          typeof cmd.payload.expectedVersion === "number"
            ? cmd.payload.expectedVersion
            : undefined;
        try {
          await assertCanAccessTask(scope, taskId);
        } catch (err) {
          if (err instanceof AppError) {
            const mapped = await conflictFromAccessLoss(
              cmd,
              err,
              expectedVersion,
            );
            if (mapped) return mapped;
          }
          throw err;
        }
        const result = await startCleaningTask({
          taskId,
          employeeId: user.employeeId,
          commandId: cmd.commandId,
          expectedVersion,
        });
        return { commandId: cmd.commandId, status: "ok", data: result };
      }
      case "cleaning.complete": {
        if (!(await canPerform(user.role, "cleaning.complete"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing cleaning.complete",
          };
        }
        const sessionId = String(cmd.payload.sessionId ?? "");
        const notes =
          typeof cmd.payload.notes === "string" ? cmd.payload.notes : undefined;
        const expectedVersion =
          typeof cmd.payload.expectedVersion === "number"
            ? cmd.payload.expectedVersion
            : undefined;
        try {
          await assertCanAccessSession(scope, sessionId);
        } catch (err) {
          if (err instanceof AppError) {
            const mapped = await conflictFromAccessLoss(
              cmd,
              err,
              expectedVersion,
            );
            if (mapped) return mapped;
          }
          throw err;
        }
        const result = await completeCleaningSession({
          sessionId,
          employeeId: user.employeeId,
          commandId: cmd.commandId,
          notes,
          expectedVersion,
        });
        return { commandId: cmd.commandId, status: "ok", data: result };
      }
      case "ticket.report": {
        if (!(await canPerform(user.role, "tickets.report"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing tickets.report",
          };
        }
        const locationId = String(cmd.payload.locationId ?? "");
        await assertCanAccessLocation(scope, locationId);
        const blocksRoom = Boolean(cmd.payload.blocksRoom);
        const result = await createMaintenanceTicket({
          locationId,
          title:
            typeof cmd.payload.title === "string" ? cmd.payload.title : undefined,
          issueOptionId:
            typeof cmd.payload.issueOptionId === "string"
              ? cmd.payload.issueOptionId
              : undefined,
          categoryId:
            typeof cmd.payload.categoryId === "string"
              ? cmd.payload.categoryId
              : undefined,
          priority:
            typeof cmd.payload.priority === "string"
              ? (cmd.payload.priority as Priority)
              : undefined,
          blocksRoom,
          reportedByEmployeeId: user.employeeId,
          commandId: cmd.commandId,
        });
        return { commandId: cmd.commandId, status: "ok", data: result };
      }
      case "ticket.start": {
        if (!(await canPerform(user.role, "tickets.resolve"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing tickets.resolve",
          };
        }
        const ticketId = String(cmd.payload.ticketId ?? "");
        await assertCanAccessTicket(scope, ticketId);
        const ticket = await startMaintenanceTicket({
          ticketId,
          actorEmployeeId: user.employeeId,
          commandId: cmd.commandId,
        });
        return { commandId: cmd.commandId, status: "ok", data: ticket };
      }
      case "ticket.wait": {
        if (!(await canPerform(user.role, "tickets.resolve"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing tickets.resolve",
          };
        }
        const ticketId = String(cmd.payload.ticketId ?? "");
        await assertCanAccessTicket(scope, ticketId);
        const ticket = await waitMaintenanceTicket({
          ticketId,
          actorEmployeeId: user.employeeId,
          reason:
            typeof cmd.payload.reason === "string"
              ? cmd.payload.reason
              : undefined,
          commandId: cmd.commandId,
        });
        return { commandId: cmd.commandId, status: "ok", data: ticket };
      }
      case "ticket.resume": {
        if (!(await canPerform(user.role, "tickets.resolve"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing tickets.resolve",
          };
        }
        const ticketId = String(cmd.payload.ticketId ?? "");
        await assertCanAccessTicket(scope, ticketId);
        const ticket = await resumeMaintenanceTicket({
          ticketId,
          actorEmployeeId: user.employeeId,
          commandId: cmd.commandId,
        });
        return { commandId: cmd.commandId, status: "ok", data: ticket };
      }
      case "ticket.resolve": {
        if (!(await canPerform(user.role, "tickets.resolve"))) {
          return {
            commandId: cmd.commandId,
            status: "forbidden",
            message: "Missing tickets.resolve",
          };
        }
        const ticketId = String(cmd.payload.ticketId ?? "");
        await assertCanAccessTicket(scope, ticketId);
        const ticket = await resolveMaintenanceTicket({
          ticketId,
          resolvedByEmployeeId: user.employeeId,
          resolutionNotes:
            typeof cmd.payload.resolutionNotes === "string"
              ? cmd.payload.resolutionNotes
              : undefined,
          commandId: cmd.commandId,
        });
        return { commandId: cmd.commandId, status: "ok", data: ticket };
      }
      default:
        return {
          commandId: cmd.commandId,
          status: "error",
          message: `Unknown command type ${cmd.type}`,
        };
    }
  } catch (err) {
    if (err instanceof AppError) {
      if (err.status === 403) {
        return {
          commandId: cmd.commandId,
          status: "forbidden",
          message: err.message,
        };
      }
      if (err.status === 409) {
        return {
          commandId: cmd.commandId,
          status: "conflict",
          message: err.message,
          code: err.code,
          details: err.details,
        };
      }
      return {
        commandId: cmd.commandId,
        status: "error",
        message: err.message,
      };
    }
    return {
      commandId: cmd.commandId,
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function pushSync(input: {
  user: AuthUser;
  commands: SyncCommand[];
  deviceId?: string;
}) {
  const startedAt = new Date();
  const results: SyncCommandResult[] = [];
  for (const cmd of input.commands) {
    results.push(await applyCommand(input.user, cmd));
  }
  const accepted = results.filter((r) => r.status === "ok").length;
  const rejected = results.length - accepted;
  const conflicts = results.filter((r) => r.status !== "ok");

  const syncRun = await prisma.syncRun.create({
    data: {
      userId: input.user.userId,
      deviceId: input.deviceId ?? null,
      direction: "push",
      startedAt,
      finishedAt: new Date(),
      status: rejected === 0 ? "ok" : accepted === 0 ? "error" : "partial",
      accepted,
      rejected,
      conflicts: conflicts.length
        ? (conflicts as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  if (input.deviceId) {
    await prisma.device.updateMany({
      where: { id: input.deviceId, userId: input.user.userId },
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  await recordAudit({
    actorEmployeeId: input.user.employeeId,
    action: "sync.push",
    entityType: "sync_run",
    entityId: syncRun.id,
    after: { accepted, rejected, commandCount: input.commands.length },
  });

  return { syncRunId: syncRun.id, results, serverTime: new Date().toISOString() };
}

export async function pullSync(input: {
  user: AuthUser;
  since?: Date;
  hotelDate?: string;
  deviceId?: string;
}) {
  const startedAt = new Date();
  const myWork = await getMyWork(input.user, input.hotelDate);

  if (input.deviceId) {
    await prisma.device.updateMany({
      where: { id: input.deviceId, userId: input.user.userId },
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  const syncRun = await prisma.syncRun.create({
    data: {
      userId: input.user.userId,
      deviceId: input.deviceId ?? null,
      direction: "pull",
      startedAt,
      finishedAt: new Date(),
      status: "ok",
      accepted: myWork.tasks.length + myWork.tickets.length,
      rejected: 0,
    },
  });

  return {
    syncRunId: syncRun.id,
    serverTime: new Date().toISOString(),
    since: input.since?.toISOString() ?? null,
    myWork,
  };
}
