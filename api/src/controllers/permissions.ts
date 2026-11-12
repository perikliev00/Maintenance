/** Permissions matrix HTTP handlers (permissions.manage on the route). */
import type { Request, Response } from "express";
// Import dependency @prisma/client.
import { Role } from "@prisma/client";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring getFullMatrix into scope from the import.
  getFullMatrix,
  // Bring listPermissionHistory into scope from the import.
  listPermissionHistory,
  // Bring replaceRoleGrants into scope from the import.
  replaceRoleGrants,
} from "../services/roleGrants";
// Import local module ../permissions.
import { MATRIX_ROLES } from "../permissions";

/** Full panel/action matrix; actor role may affect what is editable in the service. */
export async function getMatrix(req: Request, res: Response) {
  // JSON success response with the payload.
  return res.json(await getFullMatrix(req.user!.role));
}

/** Parse history `limit` query: omit → undefined; invalid → 400. */
export function parseHistoryLimit(
  // Provide raw for the object/call below.
  raw: unknown,
// Continue the controller logic.
): { ok: true; limit?: number } | { ok: false; message: string } {
  // Branch when this condition holds.
  if (raw === undefined || raw === null || raw === "") {
    // Return value or early exit.
    return { ok: true, limit: undefined };
  }
  // Branch when this condition holds.
  if (typeof raw !== "string") {
    // Return value or early exit.
    return { ok: false, message: "limit must be an integer string" };
  }
  // Guard: skip or fail when the negated condition holds.
  if (!/^\d+$/.test(raw)) {
    // Return value or early exit.
    return { ok: false, message: "limit must be a positive integer" };
  }
  // Bind limit for use in the handler below.
  const limit = Number.parseInt(raw, 10);
  // Guard: skip or fail when the negated condition holds.
  if (!Number.isFinite(limit) || limit < 1) {
    // Return value or early exit.
    return { ok: false, message: "limit must be a positive integer" };
  }
  // Return value or early exit.
  return { ok: true, limit };
}

/** GET /permissions/history — optional role filter and limit. */
export async function listHistory(req: Request, res: Response) {
  // Bind roleRaw for use in the handler below.
  const roleRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.role === "string" ? req.query.role : undefined;
  // Bind role for use in the handler below.
  const role =
    // Continue the controller logic.
    roleRaw && (MATRIX_ROLES as string[]).includes(roleRaw)
      // Continue the conditional expression.
      ? (roleRaw as Role)
      // Continue the conditional expression.
      : undefined;
  // Bind parsedLimit for use in the handler below.
  const parsedLimit = parseHistoryLimit(req.query.limit);
  // Guard: skip or fail when the negated condition holds.
  if (!parsedLimit.ok) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide message for the object/call below.
      message: parsedLimit.message,
    });
  }
  // JSON success response with the payload.
  return res.json(
    // Await side-effecting async work.
    await listPermissionHistory({ role, limit: parsedLimit.limit }),
  );
}

/** Accept any known Role string; service rejects owner / non-editable targets. */
function parseRoleParam(raw: string | undefined): Role | null {
  // Guard: skip or fail when the negated condition holds.
  if (!raw) return null;
  // Return value or early exit.
  return (Object.values(Role) as string[]).includes(raw) ? (raw as Role) : null;
}

/** Replace all panel/action grants for a matrix role (audited in the service). */
export async function replaceRole(req: Request, res: Response) {
  // Bind roleParam for use in the handler below.
  const roleParam = parseRoleParam(
    // Narrow the runtime type before using the value.
    typeof req.params.role === "string" ? req.params.role : undefined,
  );
  // Guard: skip or fail when the negated condition holds.
  if (!roleParam) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide message for the object/call below.
      message: "Unknown role",
    });
  }
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field panels.
    panels: z.array(z.string()),
    // Validate field actions.
    actions: z.array(z.string()),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().positive(),
    // Validate field reason.
    reason: z.string().max(500).optional(),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Return value or early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Invoke service and capture the result payload.
  const result = await replaceRoleGrants({
    // Provide targetRole for the object/call below.
    targetRole: roleParam,
    // Provide panels for the object/call below.
    panels: parsed.data.panels,
    // Provide actions for the object/call below.
    actions: parsed.data.actions,
    // Provide expectedVersion for the object/call below.
    expectedVersion: parsed.data.expectedVersion,
    // Provide actorRole for the object/call below.
    actorRole: req.user!.role,
    // Provide actorEmployeeId for the object/call below.
    actorEmployeeId: req.user!.employeeId,
    // Provide reason for the object/call below.
    reason: parsed.data.reason,
  });
  // JSON success response with the payload.
  return res.json(result);
}
