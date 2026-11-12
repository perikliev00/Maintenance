/**
 * Shared helpers for maintenance ticket lifecycle integration tests (P1-37…P1-47).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import {
  Priority,
  PrismaClient,
  TicketStatus,
} from "@prisma/client";
import {
  assignMaintenanceTicket,
  createMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../src/services/maintenance";
import { upsertSlaPolicy } from "../../src/services/slaPolicies";
import { getOperations, updateSetting } from "../../src/services/settings";
import type { OperationsSettings } from "../../src/services/settings/schema";
import {
  CLN_PASSWORD,
  cleanupReadinessWorld,
  createReadinessWorld,
  errCode,
  findActiveIssueOption,
  getJson,
  isAppError,
  listenApp,
  closeServer,
  loginBearer,
  patchJson,
  postJson,
  prepareRoomBase,
  // Shape ReadinessWorld documents the fixture/response fields this suite touches.
  type ReadinessWorld,
} from "../readiness/fixtures";
import {
  runWhileRowLocked,
  waitForLockWaiter,
} from "../cleaning/fixtures";

// Re-export selected symbols for suite consumers.
export {
  CLN_PASSWORD,
  cleanupReadinessWorld,
  createReadinessWorld,
  errCode,
  findActiveIssueOption,
  getJson,
  isAppError,
  listenApp,
  closeServer,
  loginBearer,
  patchJson,
  postJson,
  prepareRoomBase,
  runWhileRowLocked,
  waitForLockWaiter,
};
export type { ReadinessWorld };

// Export TicketsWorld for shared test/setup consumers.
export type TicketsWorld = ReadinessWorld;

// Export createTicketsWorld for shared test/setup consumers.
export const createTicketsWorld = createReadinessWorld;
// Export cleanupTicketsWorld for shared test/setup consumers.
export const cleanupTicketsWorld = cleanupReadinessWorld;

/** Patch SLA policy for a priority; restore in finally. */
export async function withSlaPolicyPatch<T>(
  prisma: PrismaClient,
  actorEmployeeId: string,
  priority: Priority,
  patch: { hours?: number; isActive?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  const existing = await prisma.slaPolicy.findUnique({ where: { priority } });
  assert.ok(existing, `SLA policy missing for ${priority}`);
  await upsertSlaPolicy({
    priority,
    hours: patch.hours ?? existing.hours,
    isActive: patch.isActive ?? existing.isActive,
    actorEmployeeId,
  });
  try {
    return await fn();
  } finally {
    await upsertSlaPolicy({
      priority,
      hours: existing.hours,
      isActive: existing.isActive,
      actorEmployeeId,
    });
  }
}

/**
 * Delete the SLA policy row for a priority (no DB record), run fn, then restore.
 * Caller must ensure no tickets still reference slaPolicyId for that priority.
 */
export async function withMissingSlaPolicy<T>(
  prisma: PrismaClient,
  actorEmployeeId: string,
  priority: Priority,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = await prisma.slaPolicy.findUnique({ where: { priority } });
  assert.ok(existing, `SLA policy missing for ${priority}`);
  // Clear FK refs from any leftover tickets before delete.
  await prisma.maintenanceTicket.updateMany({
    where: { slaPolicyId: existing.id },
    data: { slaPolicyId: null },
  });
  await prisma.slaPolicy.delete({ where: { priority } });
  try {
    return await fn();
  } finally {
    await upsertSlaPolicy({
      priority,
      hours: existing.hours,
      isActive: existing.isActive,
      actorEmployeeId,
    });
  }
}

/** Patch operations.defaultTicketSlaHours; restore in finally. */
export async function withDefaultSlaHours<T>(
  actorEmployeeId: string,
  hours: number,
  fn: () => Promise<T>,
): Promise<T> {
  const original = await getOperations();
  const next: OperationsSettings = {
    ...original,
    defaultTicketSlaHours: hours,
  };
  await updateSetting({
    key: "operations",
    value: next,
    actorEmployeeId,
    reason: "tkt test default SLA patch",
  });
  try {
    return await fn();
  } finally {
    await updateSetting({
      key: "operations",
      value: original,
      actorEmployeeId,
      reason: "tkt test default SLA restore",
    });
  }
}

/** Create a non-blocking ticket in `new` via production create. */
export async function reportTicket(
  prisma: PrismaClient,
  world: TicketsWorld,
  opts: {
    locationId?: string;
    blocksRoom?: boolean;
    commandId?: string;
    priority?: Priority;
    now?: Date;
    issueOptionId?: string;
    categoryId?: string;
    title?: string;
    description?: string;
    /** When true, bypass exact duplicate prevention (tests that need parallel actives). */
    allowDuplicate?: boolean;
    duplicateOverrideReason?: string;
  } = {},
) {
  const option = opts.issueOptionId
    ? null
    : opts.categoryId
      ? null
      : await findActiveIssueOption(prisma);
  return createMaintenanceTicket({
    locationId: opts.locationId ?? world.locationAId,
    issueOptionId: opts.issueOptionId ?? option?.id,
    categoryId: opts.categoryId,
    title: opts.title,
    description: opts.description,
    blocksRoom: opts.blocksRoom ?? false,
    reportedByEmployeeId: world.owner.employeeId,
    priority: opts.priority ?? Priority.normal,
    commandId: opts.commandId ?? randomUUID(),
    now: opts.now,
    allowDuplicate: opts.allowDuplicate,
    duplicateOverrideReason:
      opts.duplicateOverrideReason ??
      (opts.allowDuplicate ? "test parallel active ticket" : undefined),
  });
}

/** Advance ticket to assigned + optionally in_progress / waiting. */
export async function advanceTicketTo(
  world: TicketsWorld,
  ticketId: string,
  target: "assigned" | "in_progress" | "waiting",
  assigneeId = world.technician.employeeId,
) {
  await assignMaintenanceTicket({
    ticketId,
    assigneeId,
    actorEmployeeId: world.owner.employeeId,
  });
  if (target === "assigned") return;

  await startMaintenanceTicket({
    ticketId,
    actorEmployeeId: assigneeId,
    commandId: randomUUID(),
  });
  if (target === "in_progress") return;

  await waitMaintenanceTicket({
    ticketId,
    actorEmployeeId: assigneeId,
    commandId: randomUUID(),
  });
}

// Export helper countTicketEvents for reuse across related tests.
export async function countTicketEvents(
  prisma: PrismaClient,
  ticketId: string,
  commandId?: string,
) {
  return prisma.ticketEvent.count({
    where: {
      ticketId,
      ...(commandId ? { commandId } : {}),
    },
  });
}

// Export helper loadTicket for reuse across related tests.
export async function loadTicket(prisma: PrismaClient, ticketId: string) {
  return prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } });
}

// Re-export selected symbols for suite consumers.
export { TicketStatus, Priority, randomUUID };
