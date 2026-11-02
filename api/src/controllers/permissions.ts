/** Permissions matrix HTTP handlers (permissions.manage on the route). */
import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod/v3";
import {
  getFullMatrix,
  listPermissionHistory,
  replaceRoleGrants,
} from "../services/roleGrants";
import { MATRIX_ROLES } from "../permissions";

/** Full panel/action matrix; actor role may affect what is editable in the service. */
export async function getMatrix(req: Request, res: Response) {
  return res.json(await getFullMatrix(req.user!.role));
}

/** Parse history `limit` query: omit → undefined; invalid → 400. */
export function parseHistoryLimit(
  raw: unknown,
): { ok: true; limit?: number } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, limit: undefined };
  }
  if (typeof raw !== "string") {
    return { ok: false, message: "limit must be an integer string" };
  }
  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: "limit must be a positive integer" };
  }
  const limit = Number.parseInt(raw, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    return { ok: false, message: "limit must be a positive integer" };
  }
  return { ok: true, limit };
}

/** GET /permissions/history — optional role filter and limit. */
export async function listHistory(req: Request, res: Response) {
  const roleRaw =
    typeof req.query.role === "string" ? req.query.role : undefined;
  const role =
    roleRaw && (MATRIX_ROLES as string[]).includes(roleRaw)
      ? (roleRaw as Role)
      : undefined;
  const parsedLimit = parseHistoryLimit(req.query.limit);
  if (!parsedLimit.ok) {
    return res.status(400).json({
      error: "validation",
      message: parsedLimit.message,
    });
  }
  return res.json(
    await listPermissionHistory({ role, limit: parsedLimit.limit }),
  );
}

/** Replace all panel/action grants for a matrix role (audited in the service). */
export async function replaceRole(req: Request, res: Response) {
  const roleParam = req.params.role as Role;
  const schema = z.object({
    panels: z.array(z.string()),
    actions: z.array(z.string()),
    expectedVersion: z.number().int().positive(),
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
    expectedVersion: parsed.data.expectedVersion,
    actorRole: req.user!.role,
    actorEmployeeId: req.user!.employeeId,
    reason: parsed.data.reason,
  });
  return res.json(result);
}
