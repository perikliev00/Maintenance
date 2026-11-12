/** Manual background-job trigger (jobs.run) and run history (jobs.view). */
import type { Request, Response } from "express";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring listJobRuns into scope from the import.
  listJobRuns,
  // Bring runAllJobs into scope from the import.
  runAllJobs,
  // Bring runLockInactiveUsers into scope from the import.
  runLockInactiveUsers,
  // Bring runOverdueSessions into scope from the import.
  runOverdueSessions,
  // Bring runStaleOpenAttendance into scope from the import.
  runStaleOpenAttendance,
  // Bring runTicketSlaBreach into scope from the import.
  runTicketSlaBreach,
} from "../services/jobs";
// Import local module ../services/jobs/executionLock.
import { runWithJobExecutionLock } from "../services/jobs/executionLock";

/** GET /jobs/runs — recent JobRun rows (default limit 50). */
export async function listRuns(req: Request, res: Response) {
  // Coerce query limit; fall back to 50 when missing/non-finite.
  const limitRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  // Await async work into runs.
  const runs = await listJobRuns(
    // Coerce or check numeric finiteness.
    Number.isFinite(limitRaw) ? limitRaw : 50,
  );
  // JSON success response.
  return res.json(runs);
}

/** Run one named job or all jobs when jobKey is omitted / "all". */
export async function run(req: Request, res: Response) {
  // Optional jobKey selects a single runner; default is all.
  const schema = z.object({
    // Provide jobKey for the object/call below.
    jobKey: z
      // Restrict to an allowed enum set.
      .enum([
        // Pass string literal argument.
        "all",
        // Pass string literal argument.
        "lock_inactive_users",
        // Pass string literal argument.
        "overdue_sessions",
        // Pass string literal argument.
        "ticket_sla_breach",
        // Pass string literal argument.
        "stale_open_attendance",
      ])
      // Allow the field to be omitted.
      .optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Bind key for use in the handler below.
  const key = parsed.data.jobKey ?? "all";
  // Bind job for use in the handler below.
  const job = key === "lock_inactive_users" ? runLockInactiveUsers
    // Continue the conditional expression.
    : key === "overdue_sessions" ? runOverdueSessions
    // Continue the conditional expression.
    : key === "ticket_sla_breach" ? runTicketSlaBreach
    // Continue the conditional expression.
    : key === "stale_open_attendance" ? runStaleOpenAttendance
    // Continue the conditional expression.
    : runAllJobs;
  // Await async work into execution.
  const execution = await runWithJobExecutionLock(job);
  // Guard: skip or fail when the negated condition holds.
  if (!execution.acquired) return res.status(409).json({ error: "job_already_running" });
  // JSON success response with the payload.
  return res.json(execution.value);
}
