/** Analytics summary for maintenance or housekeeping domains, DataScope-filtered. */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import { getAnalyticsSummary } from "../services/analytics";
import {
  locationWhere,
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
  ticketWhere,
} from "../services/dataScope";

/** Query date string that parses to a valid Date. */
const dateQuery = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date");

/** GET /analytics/summary — domain metrics for an optional from/to window. */
export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    // domain is required; from/to optional ISO date strings.
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
    // Reject malformed query before any DB work.
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }

    // Convert optional query strings to Date objects for the service.
    const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
    const to = parsed.data.to ? new Date(parsed.data.to) : undefined;
    // Caller's sector/hotel scope drives Prisma where fragments.
    const scope = await resolveDataScope(req.user!);

    // Aggregate metrics only over entities the caller may see.
    const result = await getAnalyticsSummary({
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
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}
