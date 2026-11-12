/**
 * Cleaning commandId replay helpers.
 * Same commandId with a different task/session/employee/decision is a conflict,
 * not an idempotent success (P1-26).
 */
// Re-export the shared payload-match helper under a cleaning-specific name.
export { assertCommandPayloadMatch as assertCleaningCommandPayloadMatch } from "../commandIdempotency";
