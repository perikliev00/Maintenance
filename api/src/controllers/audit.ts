import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { canPerform } from "../services/roleGrants";
import { auditScopeArgsFor, listAuditEvents } from "../services/audit";
import {
  assertCanAccessLocation,
  resolveDataScope,
  scopedLocationIdsFor,
} from "../services/dataScope";
import type { Action } from "../permissions";
import type { Role } from "@prisma/client";

async function canViewFullAudit(role: Role) {
  const allowed: Action[] = [
    "audit.view",
    "settings.manage",
    "permissions.manage",
  ];
  const checks = await Promise.all(allowed.map((a) => canPerform(role, a)));
  return checks.some(Boolean);
}

async function canViewLocationAudit(role: Role) {
  if (await canViewFullAudit(role)) return true;
  return canPerform(role, "operations.view_live");
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
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

    const role = req.user!.role;
    const locationId = parsed.data.locationId;

    if (locationId) {
      if (!(await canViewLocationAudit(role))) {
        return res.status(403).json({
          error: "forbidden",
          message: "Insufficient permissions",
        });
      }
    } else if (!(await canViewFullAudit(role))) {
      return res.status(403).json({
        error: "forbidden",
        message: "Insufficient permissions",
      });
    }

    const scope = await resolveDataScope(req.user!);
    if (locationId) {
      await assertCanAccessLocation(scope, locationId);
    }

    const scopedLocationIds = await scopedLocationIdsFor(scope);
    const scopeArgs = auditScopeArgsFor(scope, scopedLocationIds);
    const rows = await listAuditEvents({
      from: parsed.data.from ? new Date(parsed.data.from) : undefined,
      to: parsed.data.to ? new Date(parsed.data.to) : undefined,
      actorEmployeeId:
        parsed.data.actorEmployeeId ?? parsed.data.actorId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      locationId,
      action: parsed.data.action,
      limit: parsed.data.limit,
      ...scopeArgs,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}
