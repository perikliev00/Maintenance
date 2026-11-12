/**
 * Shared CleaningTask include shape and list helper used by cleaning routes
 * and mutation responses.
 */
import { Prisma } from "@prisma/client";
// Import module ../db for this service.
import { prisma } from "../db";

/**
 * Standard relations returned with cleaning task API payloads.
 * Keep list and mutation responses shape-identical via this single include.
 */
export const taskInclude = {
  // Location with floor/building for room cards on task lists.
  location: { include: { floor: { include: { building: true } } } },
  // Assignee employee (may be null for unassigned tasks).
  assignedEmployee: true,
  // Shift card fields for roster / filter UI (no full shift relations).
  shift: {
    // Set select on the structure being built.
    select: {
      // Set id on the structure being built.
      id: true,
      // Set code on the structure being built.
      code: true,
      // Set nameBg on the structure being built.
      nameBg: true,
      // Set nameEn on the structure being built.
      nameEn: true,
      // Set startTime on the structure being built.
      startTime: true,
      // Set endTime on the structure being built.
      endTime: true,
    },
  },
  // Snapshotted sector at task create time.
  sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
  // Snapshotted sector supervisor for notify / display.
  sectorSupervisor: {
    // Set select on the structure being built.
    select: { id: true, fullName: true, employeeNumber: true },
  },
  // All sessions (running + completed) for timers and history.
  sessions: true,
  // Inspections for pass/fail / rework display.
  inspections: true,
// Run next step: } satisfies Prisma.CleaningTaskInclude;
} satisfies Prisma.CleaningTaskInclude;

/**
 * List cleaning tasks matching `where`, newest hotelDate/createdAt first.
 * Always uses {@link taskInclude} so response shape matches mutations.
 */
export async function listCleaningTasks(where: Prisma.CleaningTaskWhereInput) {
  // Shared include keeps list and mutation responses shape-identical.
  return prisma.cleaningTask.findMany({
    // Set where on the structure being built.
    where: { AND: [where, { location: { catalogStatus: "active" } }] },
    // Set include on the structure being built.
    include: taskInclude,
    // Newest hotel day first, then newest create within the day.
    orderBy: [{ hotelDate: "desc" }, { createdAt: "desc" }],
  });
}
