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
  // Declare type LockInactiveActivityUser for callers and internals.
  type LockInactiveActivityUser,
  // Declare type LockInactiveClaimDb for callers and internals.
  type LockInactiveClaimDb,
  // Declare type LockInactiveClaimResult for callers and internals.
  type LockInactiveClaimResult,
  // Declare type RunLockInactiveUsersDeps for callers and internals.
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
export {
  listJobRuns,
  abandonStaleRunningJobRuns,
  finishJobRun,
  startJobRun,
  withJobRun,
} from "./runLifecycle";
// In-process interval scheduler wiring all job keys.
export { startJobScheduler, stopJobScheduler } from "./scheduler";
// Re-export selected symbols for barrel consumers.
export { isJobSchedulerDisabled } from "./schedulerFlag";
// Re-export selected symbols for barrel consumers.
export {
  afterBootstrapStartJobs,
  getJobSchedulerWireBindings,
  wireJobSchedulerAfterBootstrap,
  JOB_SCHEDULER_DISABLED_EVENT,
} from "./schedulerBoot";
// Re-export selected symbols for barrel consumers.
export { runWithJobExecutionLock, waitForJobExecution } from "./executionLock";
