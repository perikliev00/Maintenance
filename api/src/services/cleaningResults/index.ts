/**
 * Per-housekeeper cleaning results report: metrics helpers + query entrypoint.
 */
export type {
  CleaningResultsQuery,
  CleaningResultsCounters,
  CleaningResultsRow,
  CleaningResultsResponse,
// Execute: } from "./types";
} from "./types";
// Expose selected symbols from this module.
export {
  isAnomalousSession,
  sessionDurationBuckets,
  sumValidSessionMs,
  avgValidMinutesFromTaskMs,
// Execute: } from "./metrics";
} from "./metrics";
// Re-export symbols from ./getCleaningResults for callers.
export { getCleaningResults } from "./getCleaningResults";
