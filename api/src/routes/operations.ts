import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import {
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
  ticketWhere,
  locationWhere,
} from "../services/dataScope";
import { getOperationsLive } from "../services/operationsLive";

export const operationsRouter = Router();

operationsRouter.get(
  "/live",
  requireAuth,
  requireAction("operations.view_live"),
  async (req, res, next) => {
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
  },
);
