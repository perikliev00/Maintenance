import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canPerform } from "../services/roleGrants";
import { listAuditEvents } from "../services/audit";
import type { Action } from "../permissions";

export const auditRouter = Router();

async function canViewAudit(role: Parameters<typeof canPerform>[0]) {
  const allowed: Action[] = [
    "audit.view",
    "settings.manage",
    "permissions.manage",
    "operations.view_live",
  ];
  const checks = await Promise.all(allowed.map((a) => canPerform(role, a)));
  return checks.some(Boolean);
}

auditRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    if (!(await canViewAudit(req.user!.role))) {
      return res.status(403).json({
        error: "forbidden",
        message: "Insufficient permissions",
      });
    }

    const schema = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      actorId: z.string().optional(),
      actorEmployeeId: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      locationId: z.string().optional(),
      action: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }

    const rows = await listAuditEvents({
      from: parsed.data.from ? new Date(parsed.data.from) : undefined,
      to: parsed.data.to ? new Date(parsed.data.to) : undefined,
      actorEmployeeId:
        parsed.data.actorEmployeeId ?? parsed.data.actorId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      locationId: parsed.data.locationId,
      action: parsed.data.action,
      limit: parsed.data.limit,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});
