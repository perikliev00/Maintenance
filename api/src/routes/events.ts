/**
 * /events — short-lived SSE ticket issuance and the live event stream.
 * Stream authenticates via Bearer, session cookie, or ?ticket= (see controller).
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as eventsController from "../controllers/events";

export const eventsRouter = Router();

// POST /ticket — issue a short-lived SSE ticket for EventSource clients.
eventsRouter.post("/ticket", requireAuth, asyncHandler(eventsController.issueTicket));

// GET /stream — live SSE; no requireAuth (EventSource cannot send custom headers).
// Auth is inside stream() via Bearer, session cookie, or ?ticket=.
eventsRouter.get("/stream", asyncHandler(eventsController.stream));
