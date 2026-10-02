import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import {
  getFullMatrix,
  listPermissionHistory,
  replaceRoleGrants,
} from "../services/roleGrants";
import { MATRIX_ROLES } from "../permissions";

export const permissionsRouter = Router();

permissionsRouter.get(
  "/matrix",
  requireAuth,
  requireAction("permissions.manage"),
  async (req, res, next) => {
    try {
      return res.json(await getFullMatrix(req.user!.role));
    } catch (err) {
      return next(err);
    }
  },
);

permissionsRouter.get(
  "/history",
  requireAuth,
  requireAction("permissions.manage"),
  async (req, res, next) => {
    try {
      const roleRaw =
        typeof req.query.role === "string" ? req.query.role : undefined;
      const role =
        roleRaw && (MATRIX_ROLES as string[]).includes(roleRaw)
          ? (roleRaw as Role)
          : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Number.parseInt(req.query.limit, 10)
          : undefined;
      return res.json(await listPermissionHistory({ role, limit }));
    } catch (err) {
      return next(err);
    }
  },
);

permissionsRouter.put(
  "/roles/:role",
  requireAuth,
  requireAction("permissions.manage"),
  async (req, res, next) => {
    try {
      const roleParam = req.params.role as Role;
      const schema = z.object({
        panels: z.array(z.string()),
        actions: z.array(z.string()),
        reason: z.string().max(500).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const result = await replaceRoleGrants({
        targetRole: roleParam,
        panels: parsed.data.panels,
        actions: parsed.data.actions,
        actorRole: req.user!.role,
        actorEmployeeId: req.user!.employeeId,
        reason: parsed.data.reason,
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  },
);
