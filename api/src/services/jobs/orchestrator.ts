/**
 * Run every background job sequentially; per-job failures are captured as
 * `{ error }` entries so one failure does not abort the others.
 */
import { runLockInactiveUsers } from "./lockInactive";
import { runOverdueSessions } from "./overdueSessions";
import { runTicketSlaBreach } from "./ticketSlaBreach";
import { runStaleOpenAttendance } from "./staleAttendance";
import { jobExecutionFinished } from "../../observability";
import { flushTicketNotificationOutbox } from "../maintenance/notificationOutbox";
import { flushCleaningNotificationOutbox } from "../cleaning/notificationOutbox";
import { flushAttendanceNotificationOutbox } from "../attendance/notificationOutbox";

async function execute(key: string, task: () => Promise<unknown>) {
  const started = process.hrtime.bigint();
  try {
    const result = await task();
    const failed = !!result && typeof result === "object" && "error" in result;
    jobExecutionFinished(key, failed, Number(process.hrtime.bigint() - started) / 1e9);
    return result;
  } catch (err) {
    jobExecutionFinished(key, true, Number(process.hrtime.bigint() - started) / 1e9);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Execute all scheduled maintenance jobs and return a keyed result map. */
export async function runAllJobs() {
  // Accumulate per-job outcomes under stable keys for the scheduler / ops UI.
  const results: Record<string, unknown> = {};
  results.ticket_notifications = await execute("ticket_notifications", flushTicketNotificationOutbox);
  results.cleaning_notifications = await execute(
    "cleaning_notifications",
    flushCleaningNotificationOutbox,
  );
  results.attendance_notifications = await execute(
    "attendance_notifications",
    flushAttendanceNotificationOutbox,
  );
  // Lock users who have been inactive past the configured threshold.
  results.lock_inactive_users = await execute("lock_inactive_users", runLockInactiveUsers);
  // Auto-close cleaning sessions that exceeded their allowed duration.
  results.overdue_sessions = await execute("overdue_sessions", runOverdueSessions);
  // Mark maintenance tickets whose SLA deadline has passed.
  results.ticket_sla_breach = await execute("ticket_sla_breach", runTicketSlaBreach);
  // Flag open attendance intervals missing an end punch for too long.
  results.stale_open_attendance = await execute("stale_open_attendance", runStaleOpenAttendance);
  return results;
}
