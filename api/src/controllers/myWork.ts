/** Current employee's assigned cleaning/maintenance work for optional hotelDate/shift. */
import type { Request, Response } from "express";
import { getMyWork } from "../services/myWork";
import { z } from "zod/v3";

/** GET /my-work — tasks/tickets for the authenticated employee. */
export async function list(req: Request, res: Response) {
  // Optional hotel-date filter (YYYY-MM-DD).
  const hotelDate =
    typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
  // Optional shift filter when the UI scopes to a roster row.
  const shiftId =
    typeof req.query.shiftId === "string" ? req.query.shiftId : undefined;
  // Service uses req.user.employeeId as the assignee key.
  const parsed = z.object({
    ticketCursor: z.string().min(1).max(1024).optional(),
    ticketPageSize: z.coerce.number().int().min(1).max(100).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const data = await getMyWork(req.user!, hotelDate, shiftId, parsed.data);
  return res.json(data);
}
