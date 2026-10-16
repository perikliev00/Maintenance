/**
 * Background job wrapper around {@link markStaleOpenIntervals}.
 */
import { markStaleOpenIntervals } from "../attendance";
import { startJobRun, finishJobRun } from "./runLifecycle";

/** Flag open attendance intervals past OPEN_MISSING_END_HOURS; records a JobRun. */
export async function runStaleOpenAttendance() {
  // Persist a running JobRun so ops can see this job started.
  const run = await startJobRun("stale_open_attendance");
  try {
    // Delegate to attendance service; returns counts for the JobRun summary.
    const result = await markStaleOpenIntervals();
    await finishJobRun(run.id, "ok", result);
    return result;
  } catch (err) {
    // Record failure on the JobRun, then rethrow for the orchestrator catch.
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}
