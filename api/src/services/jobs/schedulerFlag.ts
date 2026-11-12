/**
 * Opt-out for the in-process job scheduler (E2E / local probes only).
 * Production must leave this unset so boot + interval cycles still run.
 */
export function isJobSchedulerDisabled(
  // Set env on the structure being built.
  env: NodeJS.ProcessEnv = process.env,
// Run next step: ): boolean {
): boolean {
  // Return the computed result to the caller.
  return env.DISABLE_JOB_SCHEDULER === "1";
}
