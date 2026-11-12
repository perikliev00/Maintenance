/**
 * Map Prisma unique-constraint (P2002) races on cleaning tables to HTTP 409s.
 */
import { Prisma } from "@prisma/client";
// Import ../../errors for cleaning/prismaConflicts.ts.
import { AppError } from "../../errors";
// Side-effect or default import required by this module.
import {
  // Field value required by this payload or query.
  isP2002,
  // Field value required by this payload or query.
  p2002Targets,
  // Carry this field through the payload or query.
  targetsMatch,
// Execute: } from "../db/prismaErrors";
} from "../db/prismaErrors";

// Expose selected symbols from this module.
export { isP2002, p2002Targets, targetsMatch };

/** Translate session-start unique races into user-facing conflict errors. */
export function mapStartUniqueConflict(
  // Carry this field through the payload or query.
  err: Prisma.PrismaClientKnownRequestError,
// Begin block/object for the following statements.
): never {
  // Prisma reports partial-unique targets as column names (and sometimes index names).
  if (
    // Begin list of values/items for this step.
    targetsMatch(err, [
      // Execute: "CleaningSession_one_running_per_task",
      "CleaningSession_one_running_per_task",
      // Execute: "taskId",
      "taskId",
    ])
  // Begin block/object for the following statements.
  ) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(409, "conflict", "Task already has a running session");
  }
  // Branch when this condition holds for the domain rule.
  if (
    // Begin list of values/items for this step.
    targetsMatch(err, [
      // Execute: "CleaningSession_one_running_per_employee",
      "CleaningSession_one_running_per_employee",
      // Execute: "employeeId",
      "employeeId",
    ])
  // Begin block/object for the following statements.
  ) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(409, "conflict", "Employee already has a running session");
  }
  // Unknown unique target — rethrow for the caller to handle.
  throw err;
}

/** Translate one-active-task-per-room/date unique races into 409 conflicts. */
export function mapCreateTaskUniqueConflict(
  // Carry this field through the payload or query.
  err: Prisma.PrismaClientKnownRequestError,
// Begin block/object for the following statements.
): never {
  // Capture targets for subsequent checks or writes.
  const targets = p2002Targets(err);
  // Named index or the (locationId, hotelDate) column pair both mean the same race.
  const isActiveTaskUnique =
    // Execute: targetsMatch(err, ["CleaningTask_one_active_per_room_date"]) ||
    targetsMatch(err, ["CleaningTask_one_active_per_room_date"]) ||
    // Execute: (targets.includes("locationId") && targets.includes("hotelDate"));
    (targets.includes("locationId") && targets.includes("hotelDate"));
  // Branch when this condition holds for the domain rule.
  if (isActiveTaskUnique) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "conflict",
      "conflict",
      // Execute: "Active cleaning task already exists for this room/date",
      "Active cleaning task already exists for this room/date",
    );
  }
  // Abort with an HTTP-mapped AppError or rethrow.
  throw err;
}
