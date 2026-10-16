/**
 * Run every background job sequentially; per-job failures are captured as
 * `{ error }` entries so one failure does not abort the others.
 */
import { runLockInactiveUsers } from "./lockInactive";
import { runOverdueSessions } from "./overdueSessions";
import { runTicketSlaBreach } from "./ticketSlaBreach";
import { runStaleOpenAttendance } from "./staleAttendance";

/** Execute all scheduled maintenance jobs and return a keyed result map. */
export async function runAllJobs() {
  // Accumulate per-job outcomes under stable keys for the scheduler / ops UI.
  const results: Record<string, unknown> = {};
  // Lock users who have been inactive past the configured threshold.
  results.lock_inactive_users = await runLockInactiveUsers().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  // Auto-close cleaning sessions that exceeded their allowed duration.
  results.overdue_sessions = await runOverdueSessions().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  // Mark maintenance tickets whose SLA deadline has passed.
  results.ticket_sla_breach = await runTicketSlaBreach().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  // Flag open attendance intervals missing an end punch for too long.
  results.stale_open_attendance = await runStaleOpenAttendance().catch(
    (err) => ({
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return results;
}
