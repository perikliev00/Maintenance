/**
 * In-process setInterval scheduler for background jobs (no Redis/Bull).
 */
import { runAllJobs } from "./orchestrator";
import { abandonStaleRunningJobRuns } from "./runLifecycle";
import { jobRunFinished, safeErrorMessage, log } from "../../observability";
import { runWithJobExecutionLock, waitForJobExecution } from "./executionLock";

/** Single timer handle so startJobScheduler is idempotent. */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;
let currentRun: Promise<void> | null = null;

function warnAbandonFailed(err: unknown) {
  log.warn("abandon_stale_job_runs_failed", { error: safeErrorMessage(err) });
}

async function runOnce(run: typeof runAllJobs) {
  if (currentRun) return currentRun;
  currentRun = (async () => {
    try {
      const locked = await runWithJobExecutionLock(run);
      if (!locked.acquired) return;
      const results = locked.value;
      const failed = Object.values(results).some((value) => !!value && typeof value === "object" && "error" in value);
      jobRunFinished(failed);
      if (failed) log.warn("background_job_cycle_failed");
    } catch (err) {
      jobRunFinished(true);
      log.error("background_job_cycle_failed", { error: safeErrorMessage(err) });
    } finally { currentRun = null; }
  })();
  return currentRun;
}

/** Cancel both schedules, including the delayed first run. Safe to restart. */
export async function stopJobScheduler() {
  if (initialTimer !== null) clearTimeout(initialTimer);
  if (schedulerTimer !== null) clearInterval(schedulerTimer);
  initialTimer = null;
  schedulerTimer = null;
  await currentRun;
  await waitForJobExecution();
}

/**
 * Start the interval loop once; subsequent calls are no-ops.
 * Sweeps stale `running` JobRuns on boot and on every interval tick so crash
 * orphans clear within TTL + one interval without waiting for another restart.
 * @param abandon injectable for unit tests (defaults to abandonStaleRunningJobRuns).
 */
export function startJobScheduler(
  intervalMs = 5 * 60 * 1000,
  run = runAllJobs,
  abandon: () => Promise<unknown> = abandonStaleRunningJobRuns,
) {
  // Already started — avoid stacking intervals on hot reload / double boot.
  if (schedulerTimer) return;
  // Boot sweep: only rows past the stale TTL (multi-instance safe).
  void abandon().catch(warnAbandonFailed);
  // Initial delay so boot + migrate settle before the first run.
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void runOnce(run);
  }, 15_000);
  // Recurring tick: stale sweep first, then the job cycle.
  schedulerTimer = setInterval(() => {
    void abandon().catch(warnAbandonFailed);
    void runOnce(run);
  }, intervalMs);
}
