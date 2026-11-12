/**
 * Background job wrapper around {@link markStaleOpenIntervals}.
 */
import { markStaleOpenIntervals } from "../attendance";
import { withJobRun } from "./runLifecycle";

/** Flag open attendance intervals past OPEN_MISSING_END_HOURS; records a JobRun. */
export async function runStaleOpenAttendance() {
  return withJobRun("stale_open_attendance", () => markStaleOpenIntervals());
}
