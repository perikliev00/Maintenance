/**
 * Audit event listing. Route only requires auth; this handler enforces
 * audit.view / settings.manage / permissions.manage for full history, or
 * operations.view_live when filtering to a single locationId, then applies DataScope.
 */
import type { Request, Response } from "express";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Import local module ../services/roleGrants.
import { canPerform } from "../services/roleGrants";
// Import local module ../services/audit.
import { auditScopeArgsFor, listAuditEvents } from "../services/audit";
// Continue named import list.
import {
  // Bring assertCanAccessLocation into scope from the import.
  assertCanAccessLocation,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring scopedLocationIdsFor into scope from the import.
  scopedLocationIdsFor,
} from "../services/dataScope";
// Import type-only bindings from ../permissions.
import type { Action } from "../permissions";
// Import type-only bindings from @prisma/client.
import type { Role } from "@prisma/client";

/** True if role may see hotel-wide audit (any of the listed actions). */
async function canViewFullAudit(role: Role) {
  // Continue the controller logic.
  const allowed: Action[] = [
    // Pass string literal argument.
    "audit.view",
    // Pass string literal argument.
    "settings.manage",
    // Pass string literal argument.
    "permissions.manage",
  ];
  // Parallel grant checks; any match grants full audit access.
  const checks = await Promise.all(allowed.map((a) => canPerform(role, a)));
  // Return value or early exit.
  return checks.some(Boolean);
}

/**
 * True if role may see location-filtered audit.
 * Full-audit roles always qualify; otherwise operations.view_live is enough.
 */
async function canViewLocationAudit(role: Role) {
  // Branch when this condition holds.
  if (await canViewFullAudit(role)) return true;
  // Return value or early exit.
  return canPerform(role, "operations.view_live");
}

/** GET /audit — list audit events with filters; auth gates differ by locationId. */
export async function list(req: Request, res: Response) {
  // Optional time/actor/entity/location/action filters and limit.
  const schema = z.object({
    // Validate field from.
    from: z.string().datetime().optional(),
    // Validate field to.
    to: z.string().datetime().optional(),
    // Validate field actorId.
    actorId: z.string().optional(),
    // Validate field actorEmployeeId.
    actorEmployeeId: z.string().optional(),
    // Validate field entityType.
    entityType: z.string().optional(),
    // Validate field entityId.
    entityId: z.string().optional(),
    // Validate field locationId.
    locationId: z.string().optional(),
    // Validate field action.
    action: z.string().optional(),
    // Validate field limit.
    limit: z.coerce.number().int().positive().max(500).optional(),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.query);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Return value or early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Bind role for use in the handler below.
  const role = req.user!.role;
  // Bind locationId for use in the handler below.
  const locationId = parsed.data.locationId;

  // Location-filtered: need location audit permission; else need full audit.
  if (locationId) {
    // Guard: skip or fail when the negated condition holds.
    if (!(await canViewLocationAudit(role))) {
      // Forbidden when the caller lacks access.
      return res.status(403).json({
        // Provide error for the object/call below.
        error: "forbidden",
        // Provide message for the object/call below.
        message: "Insufficient permissions",
      });
    }
  // Continue the controller logic.
  } else if (!(await canViewFullAudit(role))) {
    // Forbidden when the caller lacks access.
    return res.status(403).json({
      // Provide error for the object/call below.
      error: "forbidden",
      // Provide message for the object/call below.
      message: "Insufficient permissions",
    });
  }

  // Apply DataScope so sector-limited users cannot read out-of-scope events.
  const scope = await resolveDataScope(req.user!);
  // Branch when this condition holds.
  if (locationId) {
    // Await side-effecting async work.
    await assertCanAccessLocation(scope, locationId);
  }

  // Build Prisma scope args (location id set or hotel-wide).
  const scopedLocationIds = await scopedLocationIdsFor(scope);
  // Bind scopeArgs for use in the handler below.
  const scopeArgs = auditScopeArgsFor(scope, scopedLocationIds);
  // Await async work into rows.
  const rows = await listAuditEvents({
    // Provide from for the object/call below.
    from: parsed.data.from ? new Date(parsed.data.from) : undefined,
    // Provide to for the object/call below.
    to: parsed.data.to ? new Date(parsed.data.to) : undefined,
    // actorId is an alias for actorEmployeeId for older clients.
    actorEmployeeId:
      // Continue the controller logic.
      parsed.data.actorEmployeeId ?? parsed.data.actorId,
    // Provide entityType for the object/call below.
    entityType: parsed.data.entityType,
    // Provide entityId for the object/call below.
    entityId: parsed.data.entityId,
    // Pass locationId through.
    locationId,
    // Provide action for the object/call below.
    action: parsed.data.action,
    // Provide limit for the object/call below.
    limit: parsed.data.limit,
    // Continue the controller logic.
    ...scopeArgs,
  });
  // JSON success response with the payload.
  return res.json(rows);
}
