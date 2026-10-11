import { markStaleOpenIntervals } from "../attendance";
import { startJobRun, finishJobRun } from "./runLifecycle";

export async function runStaleOpenAttendance() {
  const run = await startJobRun("stale_open_attendance");
  try {
    const result = await markStaleOpenIntervals();
    await finishJobRun(run.id, "ok", result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}
