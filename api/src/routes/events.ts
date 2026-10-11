import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as eventsController from "../controllers/events";

export const eventsRouter = Router();

eventsRouter.post("/ticket", requireAuth, eventsController.issueTicket);

eventsRouter.get("/stream", asyncHandler(eventsController.stream));
