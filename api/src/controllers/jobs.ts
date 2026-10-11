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

export async function listRuns(req: Request, res: Response, next: NextFunction) {
  try {
    const limitRaw =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const runs = await listJobRuns(
      Number.isFinite(limitRaw) ? limitRaw : 50,
    );
    return res.json(runs);
  } catch (err) {
    return next(err);
  }
}

export async function run(req: Request, res: Response, next: NextFunction) {
  try {
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
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const key = parsed.data.jobKey ?? "all";
    if (key === "lock_inactive_users") {
      return res.json(await runLockInactiveUsers());
    }
    if (key === "overdue_sessions") {
      return res.json(await runOverdueSessions());
    }
    if (key === "ticket_sla_breach") {
      return res.json(await runTicketSlaBreach());
    }
    if (key === "stale_open_attendance") {
      return res.json(await runStaleOpenAttendance());
    }
    return res.json(await runAllJobs());
  } catch (err) {
    return next(err);
  }
}
