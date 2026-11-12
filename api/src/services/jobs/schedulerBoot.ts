/**
 * Decide whether to start the in-process job scheduler after bootstrap.
 * Production entrypoint must call `wireJobSchedulerAfterBootstrap(closing)` only —
 * that hard-wires startJobScheduler + process.env (no injectable bypasses).
 */
import { log } from "../../observability";
// Import module ./scheduler for this service.
import { startJobScheduler } from "./scheduler";
// Import module ./schedulerFlag for this service.
import { isJobSchedulerDisabled } from "./schedulerFlag";

// Export JOB_SCHEDULER_DISABLED_EVENT for reuse by other modules.
export const JOB_SCHEDULER_DISABLED_EVENT = "job_scheduler_disabled";

// Declare type JobSchedulerBootDeps for callers and internals.
export type JobSchedulerBootDeps = {
  // Set closing on the structure being built.
  closing: boolean;
  // Set start on the structure being built.
  start: () => void;
  // Set warn on the structure being built.
  warn: (payload: Record<string, unknown>) => void;
  /** Test-only clock; production wiring uses real Date. */
  now?: () => Date;
};

// Define defaultWarn — core behavior for this module.
function defaultWarn(payload: Record<string, unknown>): void {
  // Capture event for use in this scope.
  const event = String(payload.event ?? "unknown");
  // Build fields object holding related fields.
  const fields = { ...payload };
  // Run next step: delete fields.timestamp;
  delete fields.timestamp;
  // Run next step: delete fields.level;
  delete fields.level;
  // Run next step: delete fields.service;
  delete fields.service;
  // Run next step: delete fields.event;
  delete fields.event;
  // Record observability detail for operators.
  log.warn(event, fields);
}

/**
 * Fixed start/warn bindings for the production entrypoint.
 * Identity of `start` must remain `startJobScheduler` (pinned by unit tests).
 */
export function getJobSchedulerWireBindings(): {
  // Set start on the structure being built.
  start: typeof startJobScheduler;
  // Set warn on the structure being built.
  warn: (payload: Record<string, unknown>) => void;
// Run next step: } {
} {
  // Return the computed result to the caller.
  return { start: startJobScheduler, warn: defaultWarn };
}

/**
 * Start the scheduler unless shutting down or DISABLE_JOB_SCHEDULER=1 on
 * **process.env** (not an injectable env bag — that was a silent bypass).
 */
export function afterBootstrapStartJobs(deps: JobSchedulerBootDeps): void {
  // Branch when this condition holds so the right path runs.
  if (deps.closing) return;
  // Branch when this condition holds so the right path runs.
  if (isJobSchedulerDisabled(process.env)) {
    // Run next step: deps.warn({
    deps.warn({
      // Set timestamp on the structure being built.
      timestamp: (deps.now ?? (() => new Date()))().toISOString(),
      // Set level on the structure being built.
      level: "warn",
      // Set service on the structure being built.
      service: "maintenance-api",
      // Set event on the structure being built.
      event: JOB_SCHEDULER_DISABLED_EVENT,
      // Set reason on the structure being built.
      reason: "DISABLE_JOB_SCHEDULER=1",
    });
    // Exit early; nothing more to do on this path.
    return;
  }
  // Run next step: deps.start();
  deps.start();
}

/**
 * Entrypoint wiring: fixed start + warn + process.env flag. index.ts must call
 * only this with the live `closing` flag.
 * Body is intentionally a single statement so AST contracts can forbid early
 * returns, local `start` shadows, and `closing = false` reassignments.
 */
export function wireJobSchedulerAfterBootstrap(closing: boolean): void {
  // Run next step: afterBootstrapStartJobs({ ...getJobSchedulerWireBindings(), …
  afterBootstrapStartJobs({ ...getJobSchedulerWireBindings(), closing });
}
