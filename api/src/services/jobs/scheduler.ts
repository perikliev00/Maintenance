/**
 * In-process setInterval scheduler for background jobs (no Redis/Bull).
 */
import { runAllJobs } from "./orchestrator";
// Import module ./runLifecycle for this service.
import { abandonStaleRunningJobRuns } from "./runLifecycle";
// Import module ../../observability for this service.
import { jobRunFinished, safeErrorMessage, log } from "../../observability";
// Import module ./executionLock for this service.
import { runWithJobExecutionLock, waitForJobExecution } from "./executionLock";

/** Single timer handle so startJobScheduler is idempotent. */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
// Capture initial timer for use in this scope.
let initialTimer: ReturnType<typeof setTimeout> | null = null;
// Capture current run for use in this scope.
let currentRun: Promise<void> | null = null;

// Define warnAbandonFailed — core behavior for this module.
function warnAbandonFailed(err: unknown) {
  // Record observability detail for operators.
  log.warn("abandon_stale_job_runs_failed", { error: safeErrorMessage(err) });
}

// Define runOnce — core behavior for this module.
async function runOnce(run: typeof runAllJobs) {
  // Branch when this condition holds so the right path runs.
  if (currentRun) return currentRun;
  // Update current run as control flow progresses.
  currentRun = (async () => {
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load locked asynchronously for the next steps.
      const locked = await runWithJobExecutionLock(run);
      // Branch when this condition holds so the right path runs.
      if (!locked.acquired) return;
      // Capture results for use in this scope.
      const results = locked.value;
      // Capture failed for use in this scope.
      const failed = Object.values(results).some((value) => !!value && typeof value === "object" && "error" in value);
      // Run next step: jobRunFinished(failed);
      jobRunFinished(failed);
      // Branch when this condition holds so the right path runs.
      if (failed) log.warn("background_job_cycle_failed");
    // Run next step: } catch (err) {
    } catch (err) {
      // Run next step: jobRunFinished(true);
      jobRunFinished(true);
      // Record observability detail for operators.
      log.error("background_job_cycle_failed", { error: safeErrorMessage(err) });
    // Run next step: } finally { currentRun = null; }
    } finally { currentRun = null; }
  // Run next step: })();
  })();
  // Return the computed result to the caller.
  return currentRun;
}

/** Cancel both schedules, including the delayed first run. Safe to restart. */
export async function stopJobScheduler() {
  // Branch when this condition holds so the right path runs.
  if (initialTimer !== null) clearTimeout(initialTimer);
  // Branch when this condition holds so the right path runs.
  if (schedulerTimer !== null) clearInterval(schedulerTimer);
  // Update initial timer as control flow progresses.
  initialTimer = null;
  // Update scheduler timer as control flow progresses.
  schedulerTimer = null;
  // Wait for the async step before continuing.
  await currentRun;
  // Wait for the async step before continuing.
  await waitForJobExecution();
}

/**
 * Start the interval loop once; subsequent calls are no-ops.
 * Sweeps stale `running` JobRuns on boot and on every interval tick so crash
 * orphans clear within TTL + one interval without waiting for another restart.
 * @param abandon injectable for unit tests (defaults to abandonStaleRunningJobRuns).
 */
export function startJobScheduler(
  // Update interval ms as control flow progresses.
  intervalMs = 5 * 60 * 1000,
  // Update run as control flow progresses.
  run = runAllJobs,
  // Set abandon on the structure being built.
  abandon: () => Promise<unknown> = abandonStaleRunningJobRuns,
// Run next step: ) {
) {
  // Already started — avoid stacking intervals on hot reload / double boot.
  if (schedulerTimer) return;
  // Boot sweep: only rows past the stale TTL (multi-instance safe).
  void abandon().catch(warnAbandonFailed);
  // Initial delay so boot + migrate settle before the first run.
  initialTimer = setTimeout(() => {
    // Update initial timer as control flow progresses.
    initialTimer = null;
    // Run next step: void runOnce(run);
    void runOnce(run);
  // Run next step: }, 15_000);
  }, 15_000);
  // Recurring tick: stale sweep first, then the job cycle.
  schedulerTimer = setInterval(() => {
    // Run next step: void abandon().catch(warnAbandonFailed);
    void abandon().catch(warnAbandonFailed);
    // Run next step: void runOnce(run);
    void runOnce(run);
  // Run next step: }, intervalMs);
  }, intervalMs);
}
