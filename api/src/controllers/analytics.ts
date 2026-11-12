/** Analytics summary for maintenance or housekeeping domains, DataScope-filtered. */
import type { Request, Response } from "express";
import { z } from "zod/v3";
// Import local module ../services/analytics.
import { getAnalyticsSummary } from "../services/analytics";
// Continue named import list.
import {
  // Bring locationWhere into scope from the import.
  locationWhere,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring sessionTaskWhere into scope from the import.
  sessionTaskWhere,
  // Bring taskWhere into scope from the import.
  taskWhere,
  // Bring ticketWhere into scope from the import.
  ticketWhere,
} from "../services/dataScope";

/** Query date string that parses to a valid Date. */
const dateQuery = z
  // Require a string value in the schema.
  .string()
  // Enforce minimum length/value constraint.
  .min(1)
  // Add a custom refinement check.
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date");

/** GET /analytics/summary — domain metrics for an optional from/to window. */
export async function summary(req: Request, res: Response) {
  // domain is required; from/to optional ISO date strings.
  const schema = z.object({
    // Validate field domain.
    domain: z.enum(["maintenance", "housekeeping"]),
    from: dateQuery.optional(),
    to: dateQuery.optional(),
  });

  // Parse and validate input against the schema.
  const parsed = schema.safeParse({
    domain: req.query.domain,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
  });
  // Reject malformed query before any DB work.
  if (!parsed.success) {
    // Return value or early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
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
  // JSON success response with the payload.
  return res.json(result);
}
