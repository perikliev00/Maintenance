/**
 * Run every background job sequentially; per-job failures are captured as
 * `{ error }` entries so one failure does not abort the others.
 */
import { runLockInactiveUsers } from "./lockInactive";
// Import module ./overdueSessions for this service.
import { runOverdueSessions } from "./overdueSessions";
// Import module ./ticketSlaBreach for this service.
import { runTicketSlaBreach } from "./ticketSlaBreach";
// Import module ./staleAttendance for this service.
import { runStaleOpenAttendance } from "./staleAttendance";
// Import module ../../observability for this service.
import { jobExecutionFinished } from "../../observability";
// Import module ../maintenance/notificationOutbox for this service.
import { flushTicketNotificationOutbox } from "../maintenance/notificationOutbox";
// Import module ../cleaning/notificationOutbox for this service.
import { flushCleaningNotificationOutbox } from "../cleaning/notificationOutbox";
// Import module ../attendance/notificationOutbox for this service.
import { flushAttendanceNotificationOutbox } from "../attendance/notificationOutbox";

// Define execute — core behavior for this module.
async function execute(key: string, task: () => Promise<unknown>) {
  // Capture started for use in this scope.
  const started = process.hrtime.bigint();
  // Attempt the fallible work so errors can be handled below.
  try {
    // Load result asynchronously for the next steps.
    const result = await task();
    // Capture failed for use in this scope.
    const failed = !!result && typeof result === "object" && "error" in result;
    // Run next step: jobExecutionFinished(key, failed, Number(process.hrtime.bigi…
    jobExecutionFinished(key, failed, Number(process.hrtime.bigint() - started) / 1e9);
    // Return the computed result to the caller.
    return result;
  // Run next step: } catch (err) {
  } catch (err) {
    // Run next step: jobExecutionFinished(key, true, Number(process.hrtime.bigint…
    jobExecutionFinished(key, true, Number(process.hrtime.bigint() - started) / 1e9);
    // Return the computed result to the caller.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Execute all scheduled maintenance jobs and return a keyed result map. */
export async function runAllJobs() {
  // Accumulate per-job outcomes under stable keys for the scheduler / ops UI.
  const results: Record<string, unknown> = {};
  // Run next step: results.ticket_notifications = await execute("ticket_notific…
  results.ticket_notifications = await execute("ticket_notifications", flushTicketNotificationOutbox);
  // Run next step: results.cleaning_notifications = await execute(
  results.cleaning_notifications = await execute(
    // Run next step: "cleaning_notifications",
    "cleaning_notifications",
    // Run next step: flushCleaningNotificationOutbox,
    flushCleaningNotificationOutbox,
  );
  // Run next step: results.attendance_notifications = await execute(
  results.attendance_notifications = await execute(
    // Run next step: "attendance_notifications",
    "attendance_notifications",
    // Run next step: flushAttendanceNotificationOutbox,
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
  // Return the computed result to the caller.
  return results;
}
