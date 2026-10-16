/**
 * Shared CleaningTask include shape and list helper used by cleaning routes
 * and mutation responses.
 */
import { Prisma } from "@prisma/client";
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
    select: {
      id: true,
      code: true,
      nameBg: true,
      nameEn: true,
      startTime: true,
      endTime: true,
    },
  },
  // Snapshotted sector at task create time.
  sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
  // Snapshotted sector supervisor for notify / display.
  sectorSupervisor: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
  // All sessions (running + completed) for timers and history.
  sessions: true,
  // Inspections for pass/fail / rework display.
  inspections: true,
} satisfies Prisma.CleaningTaskInclude;

/**
 * List cleaning tasks matching `where`, newest hotelDate/createdAt first.
 * Always uses {@link taskInclude} so response shape matches mutations.
 */
export async function listCleaningTasks(where: Prisma.CleaningTaskWhereInput) {
  // Shared include keeps list and mutation responses shape-identical.
  return prisma.cleaningTask.findMany({
    where,
    include: taskInclude,
    // Newest hotel day first, then newest create within the day.
    orderBy: [{ hotelDate: "desc" }, { createdAt: "desc" }],
  });
}
