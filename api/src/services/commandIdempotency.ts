/**
 * Shared commandId conflict helper across cleaning, maintenance, and cards.
 */
import { AppError } from "../errors";

/** 409 when commandId is reused for a different semantic payload. */
export function assertCommandPayloadMatch(matches: boolean): void {
  if (!matches) {
    throw new AppError(
      409,
      "conflict",
      "commandId reused with a different payload",
    );
  }
}
