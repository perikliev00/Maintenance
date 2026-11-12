/**
 * Offline ticket lifecycle commands. Mid-lifecycle steps reuse tickets.resolve;
 * assign/close use their finer grants; reopen uses tickets.resolve (same as HTTP).
 * Payloads are already Zod-parsed by applyCommand.
 */
import type { AuthUser } from "../../../auth/tokens";
import { canPerform } from "../../roleGrants";
import {
  assertCanAccessLocation,
  assertCanAccessTicket,
  // Declare type DataScope for callers and internals.
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
// Import type(s) ParsedSyncCommand for typing without runtime cost.
import type { ParsedSyncCommand } from "../commandSchemas";
// Import type(s) SyncCommandResult for typing without runtime cost.
import type { SyncCommandResult } from "../types";

/** Create a ticket from offline report; location must be in the user's scope. */
export async function handleTicketReport(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.report" }>,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "tickets.report"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.report",
    };
  }
  const p = cmd.payload;
  await assertCanAccessLocation(scope, p.locationId);
  const result = await createMaintenanceTicket({
    locationId: p.locationId,
    title: p.title,
    description: p.description,
    issueOptionId: p.issueOptionId,
    categoryId: p.categoryId,
    priority: p.priority,
    blocksRoom: p.blocksRoom,
    allowDuplicate: p.allowDuplicate,
    duplicateOverrideReason: p.duplicateOverrideReason,
    confirmSimilar: p.confirmSimilar,
    reportedByEmployeeId: user.employeeId,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}

// Declare type TicketResolveGate for callers and internals.
type TicketResolveGate =
  | { ok: true; ticketId: string }
  | { ok: false; result: SyncCommandResult };

async function requireTicketResolve(
  user: AuthUser,
  scope: DataScope,
  commandId: string,
  ticketId: string,
): Promise<TicketResolveGate> {
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    return {
      ok: false,
      result: {
        commandId,
        status: "forbidden",
        message: "Missing tickets.resolve",
      },
    };
  }
  await assertCanAccessTicket(scope, ticketId);
  return { ok: true, ticketId };
}

export async function handleTicketStart(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.start" }>,
): Promise<SyncCommandResult> {
  const gate = await requireTicketResolve(
    user,
    scope,
    cmd.commandId,
    cmd.payload.ticketId,
  );
  if (!gate.ok) return gate.result;
  const ticket = await startMaintenanceTicket({
    ticketId: gate.ticketId,
    actorEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

export async function handleTicketWait(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.wait" }>,
): Promise<SyncCommandResult> {
  const gate = await requireTicketResolve(
    user,
    scope,
    cmd.commandId,
    cmd.payload.ticketId,
  );
  if (!gate.ok) return gate.result;
  const ticket = await waitMaintenanceTicket({
    ticketId: gate.ticketId,
    actorEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    reason: cmd.payload.reason,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

export async function handleTicketResume(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.resume" }>,
): Promise<SyncCommandResult> {
  const gate = await requireTicketResolve(
    user,
    scope,
    cmd.commandId,
    cmd.payload.ticketId,
  );
  if (!gate.ok) return gate.result;
  const ticket = await resumeMaintenanceTicket({
    ticketId: gate.ticketId,
    actorEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

export async function handleTicketResolve(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.resolve" }>,
): Promise<SyncCommandResult> {
  const gate = await requireTicketResolve(
    user,
    scope,
    cmd.commandId,
    cmd.payload.ticketId,
  );
  if (!gate.ok) return gate.result;
  const ticket = await resolveMaintenanceTicket({
    ticketId: gate.ticketId,
    resolvedByEmployeeId: user.employeeId,
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    resolutionNotes: cmd.payload.resolutionNotes,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

export async function handleTicketAssign(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.assign" }>,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "tickets.assign"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.assign",
    };
  }
  const { ticketId, assigneeId } = cmd.payload;
  await assertCanAccessTicket(scope, ticketId);
  const ticket = await assignMaintenanceTicket({
    ticketId,
    assigneeId,
    actorEmployeeId: user.employeeId,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

export async function handleTicketClose(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.close" }>,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "tickets.close"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.close",
    };
  }
  await assertCanAccessTicket(scope, cmd.payload.ticketId);
  const ticket = await closeMaintenanceTicket({
    ticketId: cmd.payload.ticketId,
    closedByEmployeeId: user.employeeId,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

export async function handleTicketReopen(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "ticket.reopen" }>,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing tickets.resolve",
    };
  }
  await assertCanAccessTicket(scope, cmd.payload.ticketId);
  const ticket = await reopenMaintenanceTicket({
    ticketId: cmd.payload.ticketId,
    reopenedByEmployeeId: user.employeeId,
    reason: cmd.payload.reason,
    commandId: cmd.commandId,
  });
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}
