/**
 * Per-priority ticket SLA hours. Used at ticket create to snapshot dueAt / policy id.
 * Inactive or missing policies fall back to operations.defaultTicketSlaHours.
 */
import { Priority } from "@prisma/client";
// Import module ../db for this service.
import { prisma } from "../db";
// Import module ../errors for this service.
import { AppError } from "../errors";
// Import module ./audit for this service.
import { recordAudit } from "./audit";
// Import module ./settings for this service.
import { getOperations } from "./settings";

/**
 * Resolve active policy hours for a priority, or the operations default (policyId null).
 */
export async function resolveSlaForPriority(priority: Priority) {
  // Prefer an active row for this priority.
  const policy = await prisma.slaPolicy.findFirst({
    // Set where on the structure being built.
    where: { priority, isActive: true },
  });
  // Active policy found — snapshot its id + hours onto the ticket.
  if (policy) {
    // Return the computed result to the caller.
    return { policyId: policy.id, hours: policy.hours };
  }
  // Fallback when no active policy — snapshot policyId as null on the ticket.
  const ops = await getOperations();
  // Return the computed result to the caller.
  return { policyId: null as string | null, hours: ops.defaultTicketSlaHours };
}

/** List all SLA policies ordered by priority enum. */
export async function listSlaPolicies() {
  // Ascending priority enum order for the settings table.
  return prisma.slaPolicy.findMany({
    // Set orderBy on the structure being built.
    orderBy: { priority: "asc" },
  });
}

/** Upsert by priority uniqueness; hours must be 1–168. Audits each change. */
export async function upsertSlaPolicy(input: {
  // Set priority on the structure being built.
  priority: Priority;
  // Set hours on the structure being built.
  hours: number;
  // Run next step: isActive?: boolean;
  isActive?: boolean;
  // Run next step: actorEmployeeId?: string;
  actorEmployeeId?: string;
// Run next step: }) {
}) {
  // One week max — protects against accidental multi-month SLAs.
  if (input.hours < 1 || input.hours > 168) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "hours must be between 1 and 168");
  }
  // Capture before-state for the audit trail.
  const existing = await prisma.slaPolicy.findUnique({
    // Set where on the structure being built.
    where: { priority: input.priority },
  });
  // Upsert on unique priority; create defaults isActive true when omitted.
  const row = await prisma.slaPolicy.upsert({
    // Set where on the structure being built.
    where: { priority: input.priority },
    // Set create on the structure being built.
    create: {
      // Set priority on the structure being built.
      priority: input.priority,
      // Set hours on the structure being built.
      hours: input.hours,
      // Set isActive on the structure being built.
      isActive: input.isActive ?? true,
    },
    // Set update on the structure being built.
    update: {
      // Set hours on the structure being built.
      hours: input.hours,
      // Run next step: ...(input.isActive !== undefined ? { isActive: input.isActiv…
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  // Audit every change (create or update) for the settings trail.
  await recordAudit({
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.actorEmployeeId,
    // Set action on the structure being built.
    action: "sla_policy.upsert",
    // Set entityType on the structure being built.
    entityType: "sla_policy",
    // Set entityId on the structure being built.
    entityId: row.id,
    // Set before on the structure being built.
    before: existing
      // Complete the ternary or optional chain started above.
      ? { hours: existing.hours, isActive: existing.isActive }
      // Complete the ternary or optional chain started above.
      : null,
    // Set after on the structure being built.
    after: { priority: row.priority, hours: row.hours, isActive: row.isActive },
    // Set summary on the structure being built.
    summary: `Updated SLA for ${row.priority} to ${row.hours}h`,
  });
  // Return the computed result to the caller.
  return row;
}

/**
 * Seed default hours per priority when missing. Existing rows are left untouched
 * (update: {}) so admin edits survive restarts.
 */
export async function ensureDefaultSlaPolicies() {
  // Built-in hours per priority for a fresh install.
  const defaults: Array<{ priority: Priority; hours: number }> = [
    // Run next step: { priority: Priority.low, hours: 72 },
    { priority: Priority.low, hours: 72 },
    // Run next step: { priority: Priority.normal, hours: 24 },
    { priority: Priority.normal, hours: 24 },
    // Run next step: { priority: Priority.high, hours: 8 },
    { priority: Priority.high, hours: 8 },
    // Run next step: { priority: Priority.urgent, hours: 4 },
    { priority: Priority.urgent, hours: 4 },
  ];
  // Upsert each priority; empty update preserves admin edits on re-seed.
  for (const d of defaults) {
    // Empty update: existing admin-edited hours survive boot re-seed.
    await prisma.slaPolicy.upsert({
      // Set where on the structure being built.
      where: { priority: d.priority },
      // Set create on the structure being built.
      create: { priority: d.priority, hours: d.hours, isActive: true },
      // Set update on the structure being built.
      update: {},
    });
  }
  // Return the full table after seed for callers that display settings.
  return listSlaPolicies();
}
