import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { getAnalyticsSummary } from "../services/analytics";
import { AppError } from "../services/cleaning";
import {
  locationWhere,
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
  ticketWhere,
} from "../services/dataScope";

export const analyticsRouter = Router();

const dateQuery = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date");

analyticsRouter.get(
  "/summary",
  requireAuth,
  requireAction("analytics.view"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        domain: z.enum(["maintenance", "housekeeping"]),
        from: dateQuery.optional(),
        to: dateQuery.optional(),
      });

      const parsed = schema.safeParse({
        domain: req.query.domain,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
      });
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
      const to = parsed.data.to ? new Date(parsed.data.to) : undefined;
      const scope = await resolveDataScope(req.user!);

      const summary = await getAnalyticsSummary({
        domain: parsed.data.domain,
        from,
        to,
        scope: {
          taskWhere: taskWhere(scope),
          ticketWhere: ticketWhere(scope),
          locationWhere: locationWhere(scope),
          sessionWhere: sessionTaskWhere(scope),
        },
      });
      return res.json(summary);
    } catch (err) {
      return next(err);
    }
  },
);

analyticsRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
