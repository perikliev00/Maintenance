import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as MyWorkController from "../controllers/myWork";

export const myWorkRouter = Router();

myWorkRouter.get("/", requireAuth, MyWorkController.list);
