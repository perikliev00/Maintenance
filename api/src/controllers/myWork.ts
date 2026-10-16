/** Current employee's assigned cleaning/maintenance work for optional hotelDate/shift. */
import type { NextFunction, Request, Response } from "express";
import { getMyWork } from "../services/myWork";

/** GET /my-work — tasks/tickets for the authenticated employee. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    // Optional hotel-date filter (YYYY-MM-DD).
    const hotelDate =
      typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
    // Optional shift filter when the UI scopes to a roster row.
    const shiftId =
      typeof req.query.shiftId === "string" ? req.query.shiftId : undefined;
    // Service uses req.user.employeeId as the assignee key.
    const data = await getMyWork(req.user!, hotelDate, shiftId);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}
