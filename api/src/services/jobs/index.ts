/**
 * Background jobs: lock inactive users, overdue sessions, SLA breach notices,
 * stale attendance, plus in-process scheduler and run history.
 */
// Inactive-user lock helpers and runner (CAS + audits).
export {
  latestActivityAt,
  activitySignalsOf,
  claimLockInactiveUser,
  runLockInactiveUsers,
  type LockInactiveActivityUser,
  type LockInactiveClaimDb,
  type LockInactiveClaimResult,
  type RunLockInactiveUsersDeps,
} from "./lockInactive";
// Cleaning session overdue detection and notifications.
export { runOverdueSessions } from "./overdueSessions";
// Open ticket past-due SLA breach notices.
export { runTicketSlaBreach } from "./ticketSlaBreach";
// Attendance rows left open beyond policy.
export { runStaleOpenAttendance } from "./staleAttendance";
// Sequential orchestration entry for manual/cron triggers.
export { runAllJobs } from "./orchestrator";
// JobRun persistence helpers and history listing.
export { listJobRuns } from "./runLifecycle";
// In-process interval scheduler wiring all job keys.
export { startJobScheduler, stopJobScheduler } from "./scheduler";
