import type { NextFunction, Request, Response } from "express";
import {
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
  ticketWhere,
  locationWhere,
} from "../services/dataScope";
import { getOperationsLive } from "../services/operationsLive";

export async function live(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
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
