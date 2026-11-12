/**
 * Shared commandId conflict helper across cleaning, maintenance, and cards.
 */
import { AppError } from "../errors";

/** 409 when commandId is reused for a different semantic payload. */
export function assertCommandPayloadMatch(matches: boolean): void {
  // Branch when this condition holds so the right path runs.
  if (!matches) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 409,
      409,
      // Run next step: "conflict",
      "conflict",
      // Run next step: "commandId reused with a different payload",
      "commandId reused with a different payload",
    );
  }
}
