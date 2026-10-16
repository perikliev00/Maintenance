/** Permissions matrix HTTP handlers (permissions.manage on the route). */
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import {
  getFullMatrix,
  listPermissionHistory,
  replaceRoleGrants,
} from "../services/roleGrants";
import { MATRIX_ROLES } from "../permissions";

/** Full panel/action matrix; actor role may affect what is editable in the service. */
export async function getMatrix(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Actor role can restrict which matrix cells are editable in the response.
    return res.json(await getFullMatrix(req.user!.role));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /permissions/history — optional role filter and limit. */
export async function listHistory(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Only MATRIX_ROLES are valid filters; unknown strings become undefined.
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
    // JSON success response.
    return res.json(await listPermissionHistory({ role, limit }));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** Replace all panel/action grants for a matrix role (audited in the service). */
export async function replaceRole(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Target role comes from the URL path.
    const roleParam = req.params.role as Role;
    // Zod schema for request shape.
    const schema = z.object({
      panels: z.array(z.string()),
      actions: z.array(z.string()),
      reason: z.string().max(500).optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }

    // Service validates catalog keys, actor privileges, and writes grant history.
    const result = await replaceRoleGrants({
      targetRole: roleParam,
      panels: parsed.data.panels,
      actions: parsed.data.actions,
      actorRole: req.user!.role,
      actorEmployeeId: req.user!.employeeId,
      reason: parsed.data.reason,
    });
    // JSON success response.
    return res.json(result);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
