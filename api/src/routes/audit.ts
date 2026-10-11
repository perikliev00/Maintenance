import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as AuditController from "../controllers/audit";

export const auditRouter = Router();

auditRouter.get("/", requireAuth, AuditController.list);
