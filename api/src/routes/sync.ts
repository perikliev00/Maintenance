/** /sync — offline client push of queued mutations and pull of server state. */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as SyncController from "../controllers/sync";

export const syncRouter = Router();

// POST /push — apply queued offline commands from the client.
syncRouter.post("/push", requireAuth, SyncController.push);

// GET /pull — pull server state deltas for offline sync.
syncRouter.get("/pull", requireAuth, SyncController.pull);
