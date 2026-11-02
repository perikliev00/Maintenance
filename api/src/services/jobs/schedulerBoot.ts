/**
 * Decide whether to start the in-process job scheduler after bootstrap.
 * Production entrypoint must call `wireJobSchedulerAfterBootstrap(closing)` only —
 * that hard-wires startJobScheduler + process.env (no injectable bypasses).
 */
import { log } from "../../observability";
import { startJobScheduler } from "./scheduler";
import { isJobSchedulerDisabled } from "./schedulerFlag";

export const JOB_SCHEDULER_DISABLED_EVENT = "job_scheduler_disabled";

export type JobSchedulerBootDeps = {
  closing: boolean;
  start: () => void;
  warn: (payload: Record<string, unknown>) => void;
  /** Test-only clock; production wiring uses real Date. */
  now?: () => Date;
};

function defaultWarn(payload: Record<string, unknown>): void {
  const event = String(payload.event ?? "unknown");
  const fields = { ...payload };
  delete fields.timestamp;
  delete fields.level;
  delete fields.service;
  delete fields.event;
  log.warn(event, fields);
}

/**
 * Fixed start/warn bindings for the production entrypoint.
 * Identity of `start` must remain `startJobScheduler` (pinned by unit tests).
 */
export function getJobSchedulerWireBindings(): {
  start: typeof startJobScheduler;
  warn: (payload: Record<string, unknown>) => void;
} {
  return { start: startJobScheduler, warn: defaultWarn };
}

/**
 * Start the scheduler unless shutting down or DISABLE_JOB_SCHEDULER=1 on
 * **process.env** (not an injectable env bag — that was a silent bypass).
 */
export function afterBootstrapStartJobs(deps: JobSchedulerBootDeps): void {
  if (deps.closing) return;
  if (isJobSchedulerDisabled(process.env)) {
    deps.warn({
      timestamp: (deps.now ?? (() => new Date()))().toISOString(),
      level: "warn",
      service: "maintenance-api",
      event: JOB_SCHEDULER_DISABLED_EVENT,
      reason: "DISABLE_JOB_SCHEDULER=1",
    });
    return;
  }
  deps.start();
}

/**
 * Entrypoint wiring: fixed start + warn + process.env flag. index.ts must call
 * only this with the live `closing` flag.
 * Body is intentionally a single statement so AST contracts can forbid early
 * returns, local `start` shadows, and `closing = false` reassignments.
 */
export function wireJobSchedulerAfterBootstrap(closing: boolean): void {
  afterBootstrapStartJobs({ ...getJobSchedulerWireBindings(), closing });
}
