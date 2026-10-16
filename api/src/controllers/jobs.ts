/** Manual background-job trigger and run history (jobs.view on the route). */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  listJobRuns,
  runAllJobs,
  runLockInactiveUsers,
  runOverdueSessions,
  runStaleOpenAttendance,
  runTicketSlaBreach,
} from "../services/jobs";

/** GET /jobs/runs — recent JobRun rows (default limit 50). */
export async function listRuns(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Coerce query limit; fall back to 50 when missing/non-finite.
    const limitRaw =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const runs = await listJobRuns(
      Number.isFinite(limitRaw) ? limitRaw : 50,
    );
    // JSON success response.
    return res.json(runs);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** Run one named job or all jobs when jobKey is omitted / "all". */
export async function run(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Optional jobKey selects a single runner; default is all.
    const schema = z.object({
      jobKey: z
        .enum([
          "all",
          "lock_inactive_users",
          "overdue_sessions",
          "ticket_sla_breach",
          "stale_open_attendance",
        ])
        .optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body ?? {});
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const key = parsed.data.jobKey ?? "all";
    // Dispatch to the matching job runner.
    if (key === "lock_inactive_users") {
      // JSON success response.
      return res.json(await runLockInactiveUsers());
    }
    // Branch: conditional gate.
    if (key === "overdue_sessions") {
      // JSON success response.
      return res.json(await runOverdueSessions());
    }
    // Branch: conditional gate.
    if (key === "ticket_sla_breach") {
      // JSON success response.
      return res.json(await runTicketSlaBreach());
    }
    // Branch: conditional gate.
    if (key === "stale_open_attendance") {
      // JSON success response.
      return res.json(await runStaleOpenAttendance());
    }
    // "all" or omitted — run the full orchestrator suite.
    return res.json(await runAllJobs());
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
