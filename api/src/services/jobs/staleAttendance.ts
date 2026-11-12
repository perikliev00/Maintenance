/**
 * Background job wrapper around {@link markStaleOpenIntervals}.
 */
import { markStaleOpenIntervals } from "../attendance";
// Import module ./runLifecycle for this service.
import { withJobRun } from "./runLifecycle";

/** Flag open attendance intervals past OPEN_MISSING_END_HOURS; records a JobRun. */
export async function runStaleOpenAttendance() {
  // Return the computed result to the caller.
  return withJobRun("stale_open_attendance", () => markStaleOpenIntervals());
}
