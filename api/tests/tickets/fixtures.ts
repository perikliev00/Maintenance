/**
 * Shared helpers for maintenance ticket lifecycle integration tests (P1-37…P1-47).
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  Priority,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  TicketStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  assignMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  createMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  startMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  waitMaintenanceTicket,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/maintenance";
// Import bindings from ../../src/services/slaPolicies.
import { upsertSlaPolicy } from "../../src/services/slaPolicies";
// Import bindings from ../../src/services/settings.
import { getOperations, updateSetting } from "../../src/services/settings";
// Type-only import from ../../src/services/settings/schema for compile-time contracts.
import type { OperationsSettings } from "../../src/services/settings/schema";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  createReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  errCode,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Execute the next setup or assertion step for this scenario.
  prepareRoomBase,
  // Shape ReadinessWorld documents the fixture/response fields this suite touches.
  type ReadinessWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../readiness/fixtures";
// Import module bindings used by this suite.
import {
  // Concurrency/isolation step for the race under test.
  runWhileRowLocked,
  // Concurrency/isolation step for the race under test.
  waitForLockWaiter,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";

// Re-export selected symbols for suite consumers.
export {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  createReadinessWorld,
  // Execute the next setup or assertion step for this scenario.
  errCode,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Execute the next setup or assertion step for this scenario.
  prepareRoomBase,
  // Concurrency/isolation step for the race under test.
  runWhileRowLocked,
  // Concurrency/isolation step for the race under test.
  waitForLockWaiter,
};
// Execute the next setup or assertion step for this scenario.
export type { ReadinessWorld };

// Export TicketsWorld for shared test/setup consumers.
export type TicketsWorld = ReadinessWorld;

// Export createTicketsWorld for shared test/setup consumers.
export const createTicketsWorld = createReadinessWorld;
// Export cleanupTicketsWorld for shared test/setup consumers.
export const cleanupTicketsWorld = cleanupReadinessWorld;

/** Patch SLA policy for a priority; restore in finally. */
export async function withSlaPolicyPatch<T>(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  actorEmployeeId: string,
  // Execute the next setup or assertion step for this scenario.
  priority: Priority,
  // Execute the next setup or assertion step for this scenario.
  patch: { hours?: number; isActive?: boolean },
  // Execute the next setup or assertion step for this scenario.
  fn: () => Promise<T>,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // existing: synchronize actors so the race window is observable.
  const existing = await prisma.slaPolicy.findUnique({ where: { priority } });
  // Assert the observed value matches the intended post-condition.
  assert.ok(existing, `SLA policy missing for ${priority}`);
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await upsertSlaPolicy({
    // Execute the next setup or assertion step for this scenario.
    priority,
    // Execute the next setup or assertion step for this scenario.
    hours: patch.hours ?? existing.hours,
    // Execute the next setup or assertion step for this scenario.
    isActive: patch.isActive ?? existing.isActive,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId,
  });
  // Try path where partial failure must not leak suite state.
  try {
    // Return the arranged value/result to the caller.
    return await fn();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await upsertSlaPolicy({
      // Execute the next setup or assertion step for this scenario.
      priority,
      // Execute the next setup or assertion step for this scenario.
      hours: existing.hours,
      // Execute the next setup or assertion step for this scenario.
      isActive: existing.isActive,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId,
    });
  }
}

/**
 * Delete the SLA policy row for a priority (no DB record), run fn, then restore.
 * Caller must ensure no tickets still reference slaPolicyId for that priority.
 */
export async function withMissingSlaPolicy<T>(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  actorEmployeeId: string,
  // Execute the next setup or assertion step for this scenario.
  priority: Priority,
  // Execute the next setup or assertion step for this scenario.
  fn: () => Promise<T>,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // existing: synchronize actors so the race window is observable.
  const existing = await prisma.slaPolicy.findUnique({ where: { priority } });
  // Assert the observed value matches the intended post-condition.
  assert.ok(existing, `SLA policy missing for ${priority}`);
  // Clear FK refs from any leftover tickets before delete.
  await prisma.maintenanceTicket.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { slaPolicyId: existing.id },
    // Execute the next setup or assertion step for this scenario.
    data: { slaPolicyId: null },
  });
  // Await async work before asserting or releasing locks.
  await prisma.slaPolicy.delete({ where: { priority } });
  // Try path where partial failure must not leak suite state.
  try {
    // Return the arranged value/result to the caller.
    return await fn();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await upsertSlaPolicy({
      // Execute the next setup or assertion step for this scenario.
      priority,
      // Execute the next setup or assertion step for this scenario.
      hours: existing.hours,
      // Execute the next setup or assertion step for this scenario.
      isActive: existing.isActive,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId,
    });
  }
}

/** Patch operations.defaultTicketSlaHours; restore in finally. */
export async function withDefaultSlaHours<T>(
  // Execute the next setup or assertion step for this scenario.
  actorEmployeeId: string,
  // Execute the next setup or assertion step for this scenario.
  hours: number,
  // Execute the next setup or assertion step for this scenario.
  fn: () => Promise<T>,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // original: HTTP response captured for status/body checks.
  const original = await getOperations();
  // Delivery/replay step for async notification paths.
  const next: OperationsSettings = {
    // Continue the call chain for setup or assertion detail.
    ...original,
    // Execute the next setup or assertion step for this scenario.
    defaultTicketSlaHours: hours,
  };
  // Await async work before asserting or releasing locks.
  await updateSetting({
    // Execute the next setup or assertion step for this scenario.
    key: "operations",
    // Execute the next setup or assertion step for this scenario.
    value: next,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    reason: "tkt test default SLA patch",
  });
  // Try path where partial failure must not leak suite state.
  try {
    // Return the arranged value/result to the caller.
    return await fn();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Execute the next setup or assertion step for this scenario.
      value: original,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "tkt test default SLA restore",
    });
  }
}

/** Create a non-blocking ticket in `new` via production create. */
export async function reportTicket(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: TicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  opts: {
    // Execute the next setup or assertion step for this scenario.
    locationId?: string;
    // Concurrency/isolation step for the race under test.
    blocksRoom?: boolean;
    // Execute the next setup or assertion step for this scenario.
    commandId?: string;
    // Execute the next setup or assertion step for this scenario.
    priority?: Priority;
    // Execute the next setup or assertion step for this scenario.
    now?: Date;
    // Execute the next setup or assertion step for this scenario.
    issueOptionId?: string;
    // Execute the next setup or assertion step for this scenario.
    categoryId?: string;
    // Execute the next setup or assertion step for this scenario.
    title?: string;
    // Execute the next setup or assertion step for this scenario.
    description?: string;
    /** When true, bypass exact duplicate prevention (tests that need parallel actives). */
    allowDuplicate?: boolean;
    // Execute the next setup or assertion step for this scenario.
    duplicateOverrideReason?: string;
  // Execute the next setup or assertion step for this scenario.
  } = {},
// Execute the next setup or assertion step for this scenario.
) {
  // Bind option for later setup or assertions in this scope.
  const option = opts.issueOptionId
    ? null
    : opts.categoryId
      ? null
      // Await async work before asserting or releasing locks.
      : await findActiveIssueOption(prisma);
  // Return the arranged value/result to the caller.
  return createMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    locationId: opts.locationId ?? world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    issueOptionId: opts.issueOptionId ?? option?.id,
    // Execute the next setup or assertion step for this scenario.
    categoryId: opts.categoryId,
    // Execute the next setup or assertion step for this scenario.
    title: opts.title,
    // Execute the next setup or assertion step for this scenario.
    description: opts.description,
    // Concurrency/isolation step for the race under test.
    blocksRoom: opts.blocksRoom ?? false,
    // Execute the next setup or assertion step for this scenario.
    reportedByEmployeeId: world.owner.employeeId,
    // Execute the next setup or assertion step for this scenario.
    priority: opts.priority ?? Priority.normal,
    // Execute the next setup or assertion step for this scenario.
    commandId: opts.commandId ?? randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    now: opts.now,
    // Execute the next setup or assertion step for this scenario.
    allowDuplicate: opts.allowDuplicate,
    // Execute the next setup or assertion step for this scenario.
    duplicateOverrideReason:
      // Execute the next setup or assertion step for this scenario.
      opts.duplicateOverrideReason ??
      // Concurrency/isolation step for the race under test.
      (opts.allowDuplicate ? "test parallel active ticket" : undefined),
  });
}

/** Advance ticket to assigned + optionally in_progress / waiting. */
export async function advanceTicketTo(
  // Execute the next setup or assertion step for this scenario.
  world: TicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  ticketId: string,
  // Execute the next setup or assertion step for this scenario.
  target: "assigned" | "in_progress" | "waiting",
  // Execute the next setup or assertion step for this scenario.
  assigneeId = world.technician.employeeId,
// Execute the next setup or assertion step for this scenario.
) {
  // Await async work before asserting or releasing locks.
  await assignMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    assigneeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: world.owner.employeeId,
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (target === "assigned") return;

  // Await async work before asserting or releasing locks.
  await startMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: assigneeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (target === "in_progress") return;

  // Await async work before asserting or releasing locks.
  await waitMaintenanceTicket({
    // Execute the next setup or assertion step for this scenario.
    ticketId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: assigneeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
  });
}

// Export helper countTicketEvents for reuse across related tests.
export async function countTicketEvents(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  ticketId: string,
  // Execute the next setup or assertion step for this scenario.
  commandId?: string,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return prisma.ticketEvent.count({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      ticketId,
      // Continue the call chain for setup or assertion detail.
      ...(commandId ? { commandId } : {}),
    },
  });
}

// Export helper loadTicket for reuse across related tests.
export async function loadTicket(prisma: PrismaClient, ticketId: string) {
  // Return the arranged value/result to the caller.
  return prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } });
}

// Re-export selected symbols for suite consumers.
export { TicketStatus, Priority, randomUUID };
