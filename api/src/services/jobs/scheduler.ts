import { runAllJobs } from "./orchestrator";

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** In-process scheduler — no Redis/Bull. */
export function startJobScheduler(intervalMs = 5 * 60 * 1000) {
  if (schedulerTimer) return;
  // Initial delay so boot + migrate settle
  setTimeout(() => {
    void runAllJobs().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, 15_000);
  schedulerTimer = setInterval(() => {
    void runAllJobs().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, intervalMs);
  schedulerTimer.unref?.();
}

export function stopJobScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
