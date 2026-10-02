import { Priority, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import type { AuthUser } from "../middleware/auth";
import { canPerform } from "./roleGrants";
import {
  completeCleaningSession,
  startCleaningTask,
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
  data?: unknown;
};

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
        await assertCanAccessTask(scope, taskId);
        const expectedVersion =
          typeof cmd.payload.expectedVersion === "number"
            ? cmd.payload.expectedVersion
            : undefined;
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
        await assertCanAccessSession(scope, sessionId);
        const notes =
          typeof cmd.payload.notes === "string" ? cmd.payload.notes : undefined;
        const result = await completeCleaningSession({
          sessionId,
          employeeId: user.employeeId,
          commandId: cmd.commandId,
          notes,
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
