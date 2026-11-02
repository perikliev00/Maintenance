/** /my-work — tasks/tickets assigned to the current employee (auth only). */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as MyWorkController from "../controllers/myWork";

export const myWorkRouter = Router();

// GET / — cleaning tasks and maintenance tickets for the caller's employee.
myWorkRouter.get("/", requireAuth, asyncHandler(MyWorkController.list));
