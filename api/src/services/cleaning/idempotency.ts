/**
 * Cleaning commandId replay helpers.
 * Same commandId with a different task/session/employee/decision is a conflict,
 * not an idempotent success (P1-26).
 */
import { AppError } from "../../errors";

/** 409 when commandId is reused for a different semantic payload. */
export function assertCleaningCommandPayloadMatch(matches: boolean): void {
  if (!matches) {
    throw new AppError(
      409,
      "conflict",
      "commandId reused with a different payload",
    );
  }
}
