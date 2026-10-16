/** /cleaning — mounts task, session, and results sub-routes. */
import { Router } from "express";
import { registerResultsRoutes } from "./results";
import { registerSessionRoutes } from "./sessions";
import { registerTaskRoutes } from "./tasks";

export const cleaningRouter = Router();
// Task lifecycle (create/start/inspect/reassign) and housekeeper lookup.
registerTaskRoutes(cleaningRouter);
// Session complete/cancel and overdue review listing.
registerSessionRoutes(cleaningRouter);
// Cleaning results report endpoint.
registerResultsRoutes(cleaningRouter);
