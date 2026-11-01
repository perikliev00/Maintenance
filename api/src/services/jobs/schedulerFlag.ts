/**
 * Opt-out for the in-process job scheduler (E2E / local probes only).
 * Production must leave this unset so boot + interval cycles still run.
 */
export function isJobSchedulerDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DISABLE_JOB_SCHEDULER === "1";
}
