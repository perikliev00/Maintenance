/**
 * Delete a daily plan entry by id after data-scope verification.
 * Does not reverse prior room/task effects.
 */
import { prisma } from "../../db";
// Import ../../errors for dailyPlan/delete.ts.
import { AppError } from "../../errors";
// Import ../dataScope for dailyPlan/delete.ts.
import { assertCanAccessLocation, type DataScope } from "../dataScope";

/** Soft-free the plan row only; linked cleaning tasks are left as-is. */
export async function deleteDailyPlanEntry(id: string, scope: DataScope) {
  // Ensure the row exists before scope check / delete so clients get a clear 404.
  const existing = await prisma.dailyPlanEntry.findUnique({
    // Restrict the query to the relevant rows only.
    where: { id },
    // Project only the columns the caller needs.
    select: { id: true, locationId: true },
  });
  // Guard: handle missing/invalid state before continuing.
  if (!existing) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(404, "not_found", "Plan entry not found");
  }
  // Sector / assignment callers must own the entry's location.
  await assertCanAccessLocation(scope, existing.locationId);
  // Hard-delete the plan entry; does not undo vacant/dirty or task links.
  await prisma.dailyPlanEntry.delete({ where: { id: existing.id } });
  // Early return of a terminal empty/boolean result.
  return { id: existing.id, deleted: true };
}
