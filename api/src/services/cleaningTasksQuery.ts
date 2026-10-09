import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export const taskInclude = {
  location: { include: { floor: { include: { building: true } } } },
  assignedEmployee: true,
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
  sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
  sectorSupervisor: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
  sessions: true,
  inspections: true,
} satisfies Prisma.CleaningTaskInclude;

export async function listCleaningTasks(where: Prisma.CleaningTaskWhereInput) {
  return prisma.cleaningTask.findMany({
    where,
    include: taskInclude,
    orderBy: [{ hotelDate: "desc" }, { createdAt: "desc" }],
  });
}
