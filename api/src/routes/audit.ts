/**
 * /audit (and /audit-events alias) — audit event listing.
 * Fine-grained audit.view is enforced inside the controller, not here.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as AuditController from "../controllers/audit";

export const auditRouter = Router();

// GET / — list audit events; controller checks audit.view (and scope).
auditRouter.get("/", requireAuth, AuditController.list);
