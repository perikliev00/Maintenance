/**
 * In-process setInterval scheduler for background jobs (no Redis/Bull).
 */
import { runAllJobs } from "./orchestrator";

/** Single timer handle so startJobScheduler is idempotent. */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancel both schedules, including the delayed first run. Safe to restart. */
export function stopJobScheduler() {
  if (initialTimer !== null) clearTimeout(initialTimer);
  if (schedulerTimer !== null) clearInterval(schedulerTimer);
  initialTimer = null;
  schedulerTimer = null;
}

/** Start the interval loop once; subsequent calls are no-ops. */
export function startJobScheduler(intervalMs = 5 * 60 * 1000, run = runAllJobs) {
  // Already started — avoid stacking intervals on hot reload / double boot.
  if (schedulerTimer) return;
  // Initial delay so boot + migrate settle before the first run.
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void run().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, 15_000);
  // Recurring tick at intervalMs (default 5 minutes).
  schedulerTimer = setInterval(() => {
    void run().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, intervalMs);
  // Allow the Node process to exit even if the timer is still scheduled.
  schedulerTimer.unref?.();
  initialTimer.unref?.();
}
