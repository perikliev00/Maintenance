import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import {
  listJobRuns,
  runAllJobs,
  runLockInactiveUsers,
  runOverdueSessions,
  runTicketSlaBreach,
} from "../services/jobs";

export const jobsRouter = Router();

jobsRouter.get(
  "/runs",
  requireAuth,
  requireAction("jobs.view"),
  async (req, res, next) => {
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
  },
);

jobsRouter.post(
  "/run",
  requireAuth,
  requireAction("jobs.view"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        jobKey: z
          .enum([
            "all",
            "lock_inactive_users",
            "overdue_sessions",
            "ticket_sla_breach",
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
      return res.json(await runAllJobs());
    } catch (err) {
      return next(err);
    }
  },
);
