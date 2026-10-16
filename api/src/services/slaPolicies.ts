/**
 * Per-priority ticket SLA hours. Used at ticket create to snapshot dueAt / policy id.
 * Inactive or missing policies fall back to operations.defaultTicketSlaHours.
 */
import { Priority } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { recordAudit } from "./audit";
import { getOperations } from "./settings";

/**
 * Resolve active policy hours for a priority, or the operations default (policyId null).
 */
export async function resolveSlaForPriority(priority: Priority) {
  // Prefer an active row for this priority.
  const policy = await prisma.slaPolicy.findFirst({
    where: { priority, isActive: true },
  });
  // Active policy found — snapshot its id + hours onto the ticket.
  if (policy) {
    return { policyId: policy.id, hours: policy.hours };
  }
  // Fallback when no active policy — snapshot policyId as null on the ticket.
  const ops = await getOperations();
  return { policyId: null as string | null, hours: ops.defaultTicketSlaHours };
}

/** List all SLA policies ordered by priority enum. */
export async function listSlaPolicies() {
  // Ascending priority enum order for the settings table.
  return prisma.slaPolicy.findMany({
    orderBy: { priority: "asc" },
  });
}

/** Upsert by priority uniqueness; hours must be 1–168. Audits each change. */
export async function upsertSlaPolicy(input: {
  priority: Priority;
  hours: number;
  isActive?: boolean;
  actorEmployeeId?: string;
}) {
  // One week max — protects against accidental multi-month SLAs.
  if (input.hours < 1 || input.hours > 168) {
    throw new AppError(400, "validation", "hours must be between 1 and 168");
  }
  // Capture before-state for the audit trail.
  const existing = await prisma.slaPolicy.findUnique({
    where: { priority: input.priority },
  });
  // Upsert on unique priority; create defaults isActive true when omitted.
  const row = await prisma.slaPolicy.upsert({
    where: { priority: input.priority },
    create: {
      priority: input.priority,
      hours: input.hours,
      isActive: input.isActive ?? true,
    },
    update: {
      hours: input.hours,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  // Audit every change (create or update) for the settings trail.
  await recordAudit({
    actorEmployeeId: input.actorEmployeeId,
    action: "sla_policy.upsert",
    entityType: "sla_policy",
    entityId: row.id,
    before: existing
      ? { hours: existing.hours, isActive: existing.isActive }
      : null,
    after: { priority: row.priority, hours: row.hours, isActive: row.isActive },
    summary: `Updated SLA for ${row.priority} to ${row.hours}h`,
  });
  return row;
}

/**
 * Seed default hours per priority when missing. Existing rows are left untouched
 * (update: {}) so admin edits survive restarts.
 */
export async function ensureDefaultSlaPolicies() {
  // Built-in hours per priority for a fresh install.
  const defaults: Array<{ priority: Priority; hours: number }> = [
    { priority: Priority.low, hours: 72 },
    { priority: Priority.normal, hours: 24 },
    { priority: Priority.high, hours: 8 },
    { priority: Priority.urgent, hours: 4 },
  ];
  // Upsert each priority; empty update preserves admin edits on re-seed.
  for (const d of defaults) {
    // Empty update: existing admin-edited hours survive boot re-seed.
    await prisma.slaPolicy.upsert({
      where: { priority: d.priority },
      create: { priority: d.priority, hours: d.hours, isActive: true },
      update: {},
    });
  }
  // Return the full table after seed for callers that display settings.
  return listSlaPolicies();
}
