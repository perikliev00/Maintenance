import { runLockInactiveUsers } from "./lockInactive";
import { runOverdueSessions } from "./overdueSessions";
import { runTicketSlaBreach } from "./ticketSlaBreach";
import { runStaleOpenAttendance } from "./staleAttendance";

export async function runAllJobs() {
  const results: Record<string, unknown> = {};
  results.lock_inactive_users = await runLockInactiveUsers().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  results.overdue_sessions = await runOverdueSessions().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  results.ticket_sla_breach = await runTicketSlaBreach().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  results.stale_open_attendance = await runStaleOpenAttendance().catch(
    (err) => ({
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return results;
}
