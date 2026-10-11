import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as SyncController from "../controllers/sync";

export const syncRouter = Router();

syncRouter.post("/push", requireAuth, SyncController.push);
syncRouter.get("/pull", requireAuth, SyncController.pull);
