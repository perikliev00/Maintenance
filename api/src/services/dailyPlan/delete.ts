import { prisma } from "../../db";
import { AppError } from "../../errors";

export async function deleteDailyPlanEntry(id: string) {
  const existing = await prisma.dailyPlanEntry.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Plan entry not found");
  }
  await prisma.dailyPlanEntry.delete({ where: { id } });
  return { id, deleted: true };
}
