/**
 * Offline ticket lifecycle commands. Mid-lifecycle steps reuse tickets.resolve;
 * assign/close use their finer grants; reopen uses tickets.resolve (same as HTTP).
 * report uses tickets.report. commandId is forwarded for server-side idempotency.
 */
import { Priority } from "@prisma/client";
import type { AuthUser } from "../../../middleware/auth";
import { canPerform } from "../../roleGrants";
import {
  assertCanAccessLocation,
  assertCanAccessTicket,
  type DataScope,
} from "../../dataScope";
import {
  assignMaintenanceTicket,
  closeMaintenanceTicket,
  createMaintenanceTicket,
  canBypassTicketAssignee,
  reopenMaintenanceTicket,
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../maintenance";
import type { SyncCommand, SyncCommandResult } from "../types";

/** Create a ticket from offline report; location must be in the user's scope. */
export async function handleTicketReport(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Soft-forbidden so the batch can continue with other commands.
  if (!(await canPerform(user.role, "tickets.report"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.report",
    };
  }
  // Location must be in the caller's data scope.
  const locationId = String(cmd.payload.locationId ?? "");
  await assertCanAccessLocation(scope, locationId);
  // blocksRoom drives sellability / readiness until the ticket is resolved.
  const blocksRoom = Boolean(cmd.payload.blocksRoom);
  // Narrow payload fields; commandId enables create idempotency.
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

/**
 * Start/wait/resume/resolve share the tickets.resolve action: field workers who
 * can progress tickets offline need one grant covering the mid-lifecycle set.
 */
export async function handleTicketStart(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Mid-lifecycle offline steps share tickets.resolve (see module header).
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.resolve",
    };
  }
  // Ticket must be visible under the caller's data scope.
  const ticketId = String(cmd.payload.ticketId ?? "");
  await assertCanAccessTicket(scope, ticketId);
  // Domain start (idempotent via commandId).
  const ticket = await startMaintenanceTicket({
    ticketId,
    actorEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

/** Put ticket into waiting (pauses SLA); optional reason from payload. */
export async function handleTicketWait(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Soft-forbidden; mid-lifecycle steps share tickets.resolve.
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.resolve",
    };
  }
  // Ticket must be visible under the caller's data scope.
  const ticketId = String(cmd.payload.ticketId ?? "");
  await assertCanAccessTicket(scope, ticketId);
  // Domain wait (pauses SLA clock; optional free-text reason).
  const ticket = await waitMaintenanceTicket({
    ticketId,
    actorEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    reason:
      typeof cmd.payload.reason === "string"
        ? cmd.payload.reason
        : undefined,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

/** Resume from waiting (unpauses SLA). */
export async function handleTicketResume(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Soft-forbidden; mid-lifecycle steps share tickets.resolve.
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.resolve",
    };
  }
  // Ticket must be visible under the caller's data scope.
  const ticketId = String(cmd.payload.ticketId ?? "");
  await assertCanAccessTicket(scope, ticketId);
  // Domain resume (unpauses SLA; idempotent via commandId).
  const ticket = await resumeMaintenanceTicket({
    ticketId,
    actorEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

/** Resolve ticket; optional resolutionNotes from payload. */
export async function handleTicketResolve(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Soft-forbidden; mid-lifecycle steps share tickets.resolve.
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.resolve",
    };
  }
  // Ticket must be visible under the caller's data scope.
  const ticketId = String(cmd.payload.ticketId ?? "");
  await assertCanAccessTicket(scope, ticketId);
  // Domain resolve (optional notes; idempotent via commandId).
  const ticket = await resolveMaintenanceTicket({
    ticketId,
    resolvedByEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    resolutionNotes:
      typeof cmd.payload.resolutionNotes === "string"
        ? cmd.payload.resolutionNotes
        : undefined,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

/** Assign / reassign (new|assigned only); requires tickets.assign. */
export async function handleTicketAssign(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "tickets.assign"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.assign",
    };
  }
  const ticketId = String(cmd.payload.ticketId ?? "");
  const assigneeId = String(cmd.payload.assigneeId ?? "");
  await assertCanAccessTicket(scope, ticketId);
  const ticket = await assignMaintenanceTicket({
    ticketId,
    assigneeId,
    actorEmployeeId: user.employeeId,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

/** Close a resolved ticket; requires tickets.close. */
export async function handleTicketClose(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "tickets.close"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.close",
    };
  }
  const ticketId = String(cmd.payload.ticketId ?? "");
  await assertCanAccessTicket(scope, ticketId);
  const ticket = await closeMaintenanceTicket({
    ticketId,
    closedByEmployeeId: user.employeeId,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

/**
 * Reopen resolved/closed → in_progress. Matches HTTP: tickets.resolve grant
 * (not tickets.close).
 */
export async function handleTicketReopen(
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
  const ticket = await reopenMaintenanceTicket({
    ticketId,
    reopenedByEmployeeId: user.employeeId,
    reason:
      typeof cmd.payload.reason === "string" ? cmd.payload.reason : undefined,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}
