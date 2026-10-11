import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";

export function p2002Targets(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

export function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export function targetsMatch(
  err: Prisma.PrismaClientKnownRequestError,
  needles: string[],
) {
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  return needles.some((n) => targets.some((t) => t.includes(n.toLowerCase())));
}

export function mapStartUniqueConflict(
  err: Prisma.PrismaClientKnownRequestError,
): never {
  // Prisma reports partial-unique targets as column names (and sometimes index names).
  if (
    targetsMatch(err, [
      "CleaningSession_one_running_per_task",
      "taskId",
    ])
  ) {
    throw new AppError(409, "conflict", "Task already has a running session");
  }
  if (
    targetsMatch(err, [
      "CleaningSession_one_running_per_employee",
      "employeeId",
    ])
  ) {
    throw new AppError(409, "conflict", "Employee already has a running session");
  }
  throw err;
}

export function mapCreateTaskUniqueConflict(
  err: Prisma.PrismaClientKnownRequestError,
): never {
  const targets = p2002Targets(err);
  const isActiveTaskUnique =
    targetsMatch(err, ["CleaningTask_one_active_per_room_date"]) ||
    (targets.includes("locationId") && targets.includes("hotelDate"));
  if (isActiveTaskUnique) {
    throw new AppError(
      409,
      "conflict",
      "Active cleaning task already exists for this room/date",
    );
  }
  throw err;
}
