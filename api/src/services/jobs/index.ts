/**
 * Background jobs: lock inactive users, overdue sessions, SLA breach notices,
 * stale attendance, plus in-process scheduler and run history.
 */
// Inactive-user lock helpers and runner (CAS + audits).
export {
  // Run next step: latestActivityAt,
  latestActivityAt,
  // Run next step: activitySignalsOf,
  activitySignalsOf,
  // Run next step: claimLockInactiveUser,
  claimLockInactiveUser,
  // Run next step: runLockInactiveUsers,
  runLockInactiveUsers,
  // Declare type LockInactiveActivityUser for callers and internals.
  type LockInactiveActivityUser,
  // Declare type LockInactiveClaimDb for callers and internals.
  type LockInactiveClaimDb,
  // Declare type LockInactiveClaimResult for callers and internals.
  type LockInactiveClaimResult,
  // Declare type RunLockInactiveUsersDeps for callers and internals.
  type RunLockInactiveUsersDeps,
// Run next step: } from "./lockInactive";
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
  // Run next step: listJobRuns,
  listJobRuns,
  // Run next step: abandonStaleRunningJobRuns,
  abandonStaleRunningJobRuns,
  // Run next step: finishJobRun,
  finishJobRun,
  // Run next step: startJobRun,
  startJobRun,
  // Run next step: withJobRun,
  withJobRun,
// Run next step: } from "./runLifecycle";
} from "./runLifecycle";
// In-process interval scheduler wiring all job keys.
export { startJobScheduler, stopJobScheduler } from "./scheduler";
// Re-export selected symbols for barrel consumers.
export { isJobSchedulerDisabled } from "./schedulerFlag";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: afterBootstrapStartJobs,
  afterBootstrapStartJobs,
  // Run next step: getJobSchedulerWireBindings,
  getJobSchedulerWireBindings,
  // Run next step: wireJobSchedulerAfterBootstrap,
  wireJobSchedulerAfterBootstrap,
  // Run next step: JOB_SCHEDULER_DISABLED_EVENT,
  JOB_SCHEDULER_DISABLED_EVENT,
// Run next step: } from "./schedulerBoot";
} from "./schedulerBoot";
// Re-export selected symbols for barrel consumers.
export { runWithJobExecutionLock, waitForJobExecution } from "./executionLock";
