/** Current employee's assigned cleaning/maintenance work for optional hotelDate/shift. */
import type { Request, Response } from "express";
// Import local module ../services/myWork.
import { getMyWork } from "../services/myWork";
// Import dependency zod/v3.
import { z } from "zod/v3";

/** GET /my-work — tasks/tickets for the authenticated employee. */
export async function list(req: Request, res: Response) {
  // Optional hotel-date filter (YYYY-MM-DD).
  const hotelDate =
    // Narrow the runtime type before using the value.
    typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
  // Optional shift filter when the UI scopes to a roster row.
  const shiftId =
    // Narrow the runtime type before using the value.
    typeof req.query.shiftId === "string" ? req.query.shiftId : undefined;
  // Service uses req.user.employeeId as the assignee key.
  const parsed = z.object({
    // Validate field ticketCursor.
    ticketCursor: z.string().min(1).max(1024).optional(),
    // Validate field ticketPageSize.
    ticketPageSize: z.coerce.number().int().min(1).max(100).optional(),
  // Run safeParse so validation failures stay typed.
  }).safeParse(req.query);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  // Load data from the domain service.
  const data = await getMyWork(req.user!, hotelDate, shiftId, parsed.data);
  // JSON success response with the payload.
  return res.json(data);
}
