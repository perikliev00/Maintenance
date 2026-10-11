import { Router } from "express";
import { registerResultsRoutes } from "./results";
import { registerSessionRoutes } from "./sessions";
import { registerTaskRoutes } from "./tasks";

export const cleaningRouter = Router();
registerTaskRoutes(cleaningRouter);
registerSessionRoutes(cleaningRouter);
registerResultsRoutes(cleaningRouter);
