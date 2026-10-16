/**
 * In-process setInterval scheduler for background jobs (no Redis/Bull).
 */
import { runAllJobs } from "./orchestrator";

/** Single timer handle so startJobScheduler is idempotent. */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** Start the interval loop once; subsequent calls are no-ops. */
export function startJobScheduler(intervalMs = 5 * 60 * 1000) {
  // Already started — avoid stacking intervals on hot reload / double boot.
  if (schedulerTimer) return;
  // Initial delay so boot + migrate settle before the first run.
  setTimeout(() => {
    void runAllJobs().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, 15_000);
  // Recurring tick at intervalMs (default 5 minutes).
  schedulerTimer = setInterval(() => {
    void runAllJobs().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, intervalMs);
  // Allow the Node process to exit even if the timer is still scheduled.
  schedulerTimer.unref?.();
}
