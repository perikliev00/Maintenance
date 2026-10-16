/**
 * Delete a daily plan entry by id. Does not reverse prior room/task effects.
 */
import { prisma } from "../../db";
import { AppError } from "../../errors";

/** Soft-free the plan row only; linked cleaning tasks are left as-is. */
export async function deleteDailyPlanEntry(id: string) {
  // Ensure the row exists before delete so clients get a clear 404.
  const existing = await prisma.dailyPlanEntry.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Plan entry not found");
  }
  // Hard-delete the plan entry; does not undo vacant/dirty or task links.
  await prisma.dailyPlanEntry.delete({ where: { id } });
  return { id, deleted: true };
}
