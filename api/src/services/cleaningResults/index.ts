/**
 * Per-housekeeper cleaning results report: metrics helpers + query entrypoint.
 */
export type {
  // Carry this field through the payload or query.
  CleaningResultsQuery,
  // Carry this field through the payload or query.
  CleaningResultsCounters,
  // Carry this field through the payload or query.
  CleaningResultsRow,
  // Carry this field through the payload or query.
  CleaningResultsResponse,
// Execute: } from "./types";
} from "./types";
// Expose selected symbols from this module.
export {
  // Carry this field through the payload or query.
  isAnomalousSession,
  // Carry this field through the payload or query.
  sessionDurationBuckets,
  // Carry this field through the payload or query.
  sumValidSessionMs,
  // Carry this field through the payload or query.
  avgValidMinutesFromTaskMs,
// Execute: } from "./metrics";
} from "./metrics";
// Re-export symbols from ./getCleaningResults for callers.
export { getCleaningResults } from "./getCleaningResults";
