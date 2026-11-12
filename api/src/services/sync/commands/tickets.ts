/**
 * Offline ticket lifecycle commands. Mid-lifecycle steps reuse tickets.resolve;
 * assign/close use their finer grants; reopen uses tickets.resolve (same as HTTP).
 * Payloads are already Zod-parsed by applyCommand.
 */
import type { AuthUser } from "../../../auth/tokens";
// Import module ../../roleGrants for this service.
import { canPerform } from "../../roleGrants";
// Import module dependency for this service.
import {
  // Run next step: assertCanAccessLocation,
  assertCanAccessLocation,
  // Run next step: assertCanAccessTicket,
  assertCanAccessTicket,
  // Declare type DataScope for callers and internals.
  type DataScope,
// Run next step: } from "../../dataScope";
} from "../../dataScope";
// Import module dependency for this service.
import {
  // Run next step: assignMaintenanceTicket,
  assignMaintenanceTicket,
  // Run next step: closeMaintenanceTicket,
  closeMaintenanceTicket,
  // Run next step: createMaintenanceTicket,
  createMaintenanceTicket,
  // Run next step: canBypassTicketAssignee,
  canBypassTicketAssignee,
  // Run next step: reopenMaintenanceTicket,
  reopenMaintenanceTicket,
  // Run next step: resolveMaintenanceTicket,
  resolveMaintenanceTicket,
  // Run next step: resumeMaintenanceTicket,
  resumeMaintenanceTicket,
  // Run next step: startMaintenanceTicket,
  startMaintenanceTicket,
  // Run next step: waitMaintenanceTicket,
  waitMaintenanceTicket,
// Run next step: } from "../../maintenance";
} from "../../maintenance";
// Import type(s) ParsedSyncCommand for typing without runtime cost.
import type { ParsedSyncCommand } from "../commandSchemas";
// Import type(s) SyncCommandResult for typing without runtime cost.
import type { SyncCommandResult } from "../types";

/** Create a ticket from offline report; location must be in the user's scope. */
export async function handleTicketReport(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.report" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "tickets.report"))) {
    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "forbidden",
      // Set message on the structure being built.
      message: "Missing tickets.report",
    };
  }
  // Capture p for use in this scope.
  const p = cmd.payload;
  // Wait for the async step before continuing.
  await assertCanAccessLocation(scope, p.locationId);
  // Load result asynchronously for the next steps.
  const result = await createMaintenanceTicket({
    // Set locationId on the structure being built.
    locationId: p.locationId,
    // Set title on the structure being built.
    title: p.title,
    // Set description on the structure being built.
    description: p.description,
    // Set issueOptionId on the structure being built.
    issueOptionId: p.issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: p.categoryId,
    // Set priority on the structure being built.
    priority: p.priority,
    // Set blocksRoom on the structure being built.
    blocksRoom: p.blocksRoom,
    // Set allowDuplicate on the structure being built.
    allowDuplicate: p.allowDuplicate,
    // Set duplicateOverrideReason on the structure being built.
    duplicateOverrideReason: p.duplicateOverrideReason,
    // Set confirmSimilar on the structure being built.
    confirmSimilar: p.confirmSimilar,
    // Set reportedByEmployeeId on the structure being built.
    reportedByEmployeeId: user.employeeId,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: result };
}

// Declare type TicketResolveGate for callers and internals.
type TicketResolveGate =
  // Run next step: | { ok: true; ticketId: string }
  | { ok: true; ticketId: string }
  // Run next step: | { ok: false; result: SyncCommandResult };
  | { ok: false; result: SyncCommandResult };

// Define requireTicketResolve — core behavior for this module.
async function requireTicketResolve(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set commandId on the structure being built.
  commandId: string,
  // Set ticketId on the structure being built.
  ticketId: string,
// Run next step: ): Promise<TicketResolveGate> {
): Promise<TicketResolveGate> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    // Return the computed result to the caller.
    return {
      // Set ok on the structure being built.
      ok: false,
      // Set result on the structure being built.
      result: {
        // Run next step: commandId,
        commandId,
        // Set status on the structure being built.
        status: "forbidden",
        // Set message on the structure being built.
        message: "Missing tickets.resolve",
      },
    };
  }
  // Wait for the async step before continuing.
  await assertCanAccessTicket(scope, ticketId);
  // Return the computed result to the caller.
  return { ok: true, ticketId };
}

// Define handleTicketStart — core behavior for this module.
export async function handleTicketStart(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.start" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Load gate asynchronously for the next steps.
  const gate = await requireTicketResolve(
    // Run next step: user,
    user,
    // Run next step: scope,
    scope,
    // Run next step: cmd.commandId,
    cmd.commandId,
    // Run next step: cmd.payload.ticketId,
    cmd.payload.ticketId,
  );
  // Branch when this condition holds so the right path runs.
  if (!gate.ok) return gate.result;
  // Load ticket asynchronously for the next steps.
  const ticket = await startMaintenanceTicket({
    // Set ticketId on the structure being built.
    ticketId: gate.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: user.employeeId,
    // Set bypassAssigneeCheck on the structure being built.
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

// Define handleTicketWait — core behavior for this module.
export async function handleTicketWait(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.wait" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Load gate asynchronously for the next steps.
  const gate = await requireTicketResolve(
    // Run next step: user,
    user,
    // Run next step: scope,
    scope,
    // Run next step: cmd.commandId,
    cmd.commandId,
    // Run next step: cmd.payload.ticketId,
    cmd.payload.ticketId,
  );
  // Branch when this condition holds so the right path runs.
  if (!gate.ok) return gate.result;
  // Load ticket asynchronously for the next steps.
  const ticket = await waitMaintenanceTicket({
    // Set ticketId on the structure being built.
    ticketId: gate.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: user.employeeId,
    // Set bypassAssigneeCheck on the structure being built.
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    // Set reason on the structure being built.
    reason: cmd.payload.reason,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

// Define handleTicketResume — core behavior for this module.
export async function handleTicketResume(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.resume" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Load gate asynchronously for the next steps.
  const gate = await requireTicketResolve(
    // Run next step: user,
    user,
    // Run next step: scope,
    scope,
    // Run next step: cmd.commandId,
    cmd.commandId,
    // Run next step: cmd.payload.ticketId,
    cmd.payload.ticketId,
  );
  // Branch when this condition holds so the right path runs.
  if (!gate.ok) return gate.result;
  // Load ticket asynchronously for the next steps.
  const ticket = await resumeMaintenanceTicket({
    // Set ticketId on the structure being built.
    ticketId: gate.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: user.employeeId,
    // Set bypassAssigneeCheck on the structure being built.
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

// Define handleTicketResolve — core behavior for this module.
export async function handleTicketResolve(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.resolve" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Load gate asynchronously for the next steps.
  const gate = await requireTicketResolve(
    // Run next step: user,
    user,
    // Run next step: scope,
    scope,
    // Run next step: cmd.commandId,
    cmd.commandId,
    // Run next step: cmd.payload.ticketId,
    cmd.payload.ticketId,
  );
  // Branch when this condition holds so the right path runs.
  if (!gate.ok) return gate.result;
  // Load ticket asynchronously for the next steps.
  const ticket = await resolveMaintenanceTicket({
    // Set ticketId on the structure being built.
    ticketId: gate.ticketId,
    // Set resolvedByEmployeeId on the structure being built.
    resolvedByEmployeeId: user.employeeId,
    // Set bypassAssigneeCheck on the structure being built.
    bypassAssigneeCheck: canBypassTicketAssignee(user.role),
    // Set resolutionNotes on the structure being built.
    resolutionNotes: cmd.payload.resolutionNotes,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

// Define handleTicketAssign — core behavior for this module.
export async function handleTicketAssign(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.assign" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "tickets.assign"))) {
    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "forbidden",
      // Set message on the structure being built.
      message: "Missing tickets.assign",
    };
  }
  // Destructure value fields needed locally.
  const { ticketId, assigneeId } = cmd.payload;
  // Wait for the async step before continuing.
  await assertCanAccessTicket(scope, ticketId);
  // Load ticket asynchronously for the next steps.
  const ticket = await assignMaintenanceTicket({
    // Run next step: ticketId,
    ticketId,
    // Run next step: assigneeId,
    assigneeId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: user.employeeId,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

// Define handleTicketClose — core behavior for this module.
export async function handleTicketClose(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.close" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "tickets.close"))) {
    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "forbidden",
      // Set message on the structure being built.
      message: "Missing tickets.close",
    };
  }
  // Wait for the async step before continuing.
  await assertCanAccessTicket(scope, cmd.payload.ticketId);
  // Load ticket asynchronously for the next steps.
  const ticket = await closeMaintenanceTicket({
    // Set ticketId on the structure being built.
    ticketId: cmd.payload.ticketId,
    // Set closedByEmployeeId on the structure being built.
    closedByEmployeeId: user.employeeId,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}

// Define handleTicketReopen — core behavior for this module.
export async function handleTicketReopen(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "ticket.reopen" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "tickets.resolve"))) {
    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "forbidden",
      // Set message on the structure being built.
      message: "Missing tickets.resolve",
    };
  }
  // Wait for the async step before continuing.
  await assertCanAccessTicket(scope, cmd.payload.ticketId);
  // Load ticket asynchronously for the next steps.
  const ticket = await reopenMaintenanceTicket({
    // Set ticketId on the structure being built.
    ticketId: cmd.payload.ticketId,
    // Set reopenedByEmployeeId on the structure being built.
    reopenedByEmployeeId: user.employeeId,
    // Set reason on the structure being built.
    reason: cmd.payload.reason,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: ticket };
}
