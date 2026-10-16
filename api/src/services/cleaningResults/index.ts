/**
 * Per-housekeeper cleaning results report: metrics helpers + query entrypoint.
 */
export type {
  CleaningResultsQuery,
  CleaningResultsCounters,
  CleaningResultsRow,
  CleaningResultsResponse,
} from "./types";
export {
  isAnomalousSession,
  sessionDurationBuckets,
  sumValidSessionMs,
  avgValidMinutesFromTaskMs,
} from "./metrics";
export { getCleaningResults } from "./getCleaningResults";
