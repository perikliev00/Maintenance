/** Live operations board snapshot, filtered by the caller's DataScope. */
import type { NextFunction, Request, Response } from "express";
import {
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
  ticketWhere,
  locationWhere,
} from "../services/dataScope";
import { getOperationsLive } from "../services/operationsLive";

/** GET /operations/live — board snapshot for rooms/tasks/tickets in scope. */
export async function live(req: Request, res: Response, next: NextFunction) {
  try {
    // Resolve sector/hotel scope for the authenticated user.
    const scope = await resolveDataScope(req.user!);
    // Build Prisma where fragments and fetch the live board payload.
    const data = await getOperationsLive({
      task: taskWhere(scope),
      ticket: ticketWhere(scope),
      session: sessionTaskWhere(scope),
      location: locationWhere(scope),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}
