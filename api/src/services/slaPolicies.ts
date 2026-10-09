import { Priority } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { recordAudit } from "./audit";
import { getOperations } from "./settings";

export async function resolveSlaForPriority(priority: Priority) {
  const policy = await prisma.slaPolicy.findFirst({
    where: { priority, isActive: true },
  });
  if (policy) {
    return { policyId: policy.id, hours: policy.hours };
  }
  const ops = await getOperations();
  return { policyId: null as string | null, hours: ops.defaultTicketSlaHours };
}

export async function listSlaPolicies() {
  return prisma.slaPolicy.findMany({
    orderBy: { priority: "asc" },
  });
}

export async function upsertSlaPolicy(input: {
  priority: Priority;
  hours: number;
  isActive?: boolean;
  actorEmployeeId?: string;
}) {
  if (input.hours < 1 || input.hours > 168) {
    throw new AppError(400, "validation", "hours must be between 1 and 168");
  }
  const existing = await prisma.slaPolicy.findUnique({
    where: { priority: input.priority },
  });
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

export async function ensureDefaultSlaPolicies() {
  const defaults: Array<{ priority: Priority; hours: number }> = [
    { priority: Priority.low, hours: 72 },
    { priority: Priority.normal, hours: 24 },
    { priority: Priority.high, hours: 8 },
    { priority: Priority.urgent, hours: 4 },
  ];
  for (const d of defaults) {
    await prisma.slaPolicy.upsert({
      where: { priority: d.priority },
      create: { priority: d.priority, hours: d.hours, isActive: true },
      update: {},
    });
  }
  return listSlaPolicies();
}
