import { Priority } from "@prisma/client";
import type { AuthUser } from "../../../middleware/auth";
import { canPerform } from "../../roleGrants";
import {
  assertCanAccessLocation,
  assertCanAccessTicket,
  type DataScope,
} from "../../dataScope";
import {
  createMaintenanceTicket,
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../maintenance";
import type { SyncCommand, SyncCommandResult } from "../types";

export async function handleTicketReport(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
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

export async function handleTicketStart(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
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

export async function handleTicketWait(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
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

export async function handleTicketResume(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
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

export async function handleTicketResolve(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
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
