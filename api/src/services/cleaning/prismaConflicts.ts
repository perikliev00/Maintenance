/**
 * Map Prisma unique-constraint (P2002) races on cleaning tables to HTTP 409s.
 */
import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import {
  isP2002,
  p2002Targets,
  targetsMatch,
} from "../db/prismaErrors";

export { isP2002, p2002Targets, targetsMatch };

/** Translate session-start unique races into user-facing conflict errors. */
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
  // Unknown unique target — rethrow for the caller to handle.
  throw err;
}

/** Translate one-active-task-per-room/date unique races into 409 conflicts. */
export function mapCreateTaskUniqueConflict(
  err: Prisma.PrismaClientKnownRequestError,
): never {
  const targets = p2002Targets(err);
  // Named index or the (locationId, hotelDate) column pair both mean the same race.
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
