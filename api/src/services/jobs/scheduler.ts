/**
 * In-process setInterval scheduler for background jobs (no Redis/Bull).
 */
import { runAllJobs } from "./orchestrator";
import { jobRunFinished, safeErrorMessage } from "../../observability";
import { runWithJobExecutionLock, waitForJobExecution } from "./executionLock";

/** Single timer handle so startJobScheduler is idempotent. */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;
let currentRun: Promise<void> | null = null;

async function runOnce(run: typeof runAllJobs) {
  if (currentRun) return currentRun;
  currentRun = (async () => {
    try {
      const locked = await runWithJobExecutionLock(run);
      if (!locked.acquired) return;
      const results = locked.value;
      const failed = Object.values(results).some((value) => !!value && typeof value === "object" && "error" in value);
      jobRunFinished(failed);
      if (failed) console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: "warn", service: "maintenance-api", event: "background_job_cycle_failed" }));
    } catch (err) {
      jobRunFinished(true);
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", service: "maintenance-api", event: "background_job_cycle_failed", error: safeErrorMessage(err) }));
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

/** Start the interval loop once; subsequent calls are no-ops. */
export function startJobScheduler(intervalMs = 5 * 60 * 1000, run = runAllJobs) {
  // Already started — avoid stacking intervals on hot reload / double boot.
  if (schedulerTimer) return;
  // Initial delay so boot + migrate settle before the first run.
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void runOnce(run);
  }, 15_000);
  // Recurring tick at intervalMs (default 5 minutes).
  schedulerTimer = setInterval(() => {
    void runOnce(run);
  }, intervalMs);
}
