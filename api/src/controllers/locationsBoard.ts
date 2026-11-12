/** Shared list/get/mark-dirty handlers parameterized by location kind. */
import type { Request, Response } from "express";
// Import dependency @prisma/client.
import { LocationKind } from "@prisma/client";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Import local module ../services/cleaning.
import { markRoomDirty } from "../services/cleaning";
// Continue named import list.
import {
  // Bring locationWhere into scope from the import.
  locationWhere,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
} from "../services/dataScope";
// Continue named import list.
import {
  // Bring DEFAULT_ACTIVE_LOCATION_LIMIT into scope from the import.
  DEFAULT_ACTIVE_LOCATION_LIMIT,
  // Bring MAX_ACTIVE_LOCATION_LIMIT into scope from the import.
  MAX_ACTIVE_LOCATION_LIMIT,
  // Bring findActiveLocations into scope from the import.
  findActiveLocations,
  // Bring loadScopedLocation into scope from the import.
  loadScopedLocation,
  // Bring mapLocation into scope from the import.
  mapLocation,
} from "../services/locations";

/** Build room / common-area controllers that differ only by kind + 404 label. */
export function createLocationKindController(
  // Provide kind for the object/call below.
  kind: LocationKind,
  // Provide notFoundMessage for the object/call below.
  notFoundMessage: string,
// Continue the controller logic.
) {
  // Async helper list keeps handler bodies thin.
  async function list(req: Request, res: Response) {
    // Zod schema parsed for request validation.
    const parsed = z
      // Expect a nested object shape.
      .object({
        // Validate field limit.
        limit: z.coerce
          // Continue the fluent chain.
          .number()
          // Continue the fluent chain.
          .int()
          // Continue the fluent chain.
          .positive()
          // Enforce maximum length/value constraint.
          .max(MAX_ACTIVE_LOCATION_LIMIT)
          // Allow the field to be omitted.
          .optional(),
        // Validate field cursor.
        cursor: z.string().min(1).max(2048).optional(),
      })
      // Run safeParse so validation failures stay typed.
      .safeParse(req.query);
    // Reject malformed input before any side effects.
    if (!parsed.success) {
      // Return value or early exit.
      return res
        // Set response status code.
        .status(400)
        // Attach JSON body to the response.
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Resolve caller's DataScope for Prisma filtering.
    const scope = await resolveDataScope(req.user!);
    // Continue the controller logic.
    const { rows, truncated, nextCursor } = await findActiveLocations(
      // Pass kind through.
      kind,
      // Continue the controller logic.
      locationWhere(scope),
      {
        // Provide limit for the object/call below.
        limit: parsed.data.limit ?? DEFAULT_ACTIVE_LOCATION_LIMIT,
        // Provide cursor for the object/call below.
        cursor: parsed.data.cursor,
      },
    );
    // Branch when this condition holds.
    if (truncated) res.setHeader("X-Result-Truncated", "1");
    // Branch when this condition holds.
    if (nextCursor) res.setHeader("X-Next-Cursor", nextCursor);
    // JSON success response with the payload.
    return res.json(rows.map(mapLocation));
  }

  // Async helper get keeps handler bodies thin.
  async function get(req: Request, res: Response) {
    // Resolve caller's DataScope for Prisma filtering.
    const scope = await resolveDataScope(req.user!);
    // Await async work into location.
    const location = await loadScopedLocation(scope, req.params.id, {
      // Pass kind through.
      kind,
      // Pass notFoundMessage through.
      notFoundMessage,
    });
    // JSON success response with the payload.
    return res.json(mapLocation(location));
  }

  // Async helper markDirty keeps handler bodies thin.
  async function markDirty(req: Request, res: Response) {
    // Resolve caller's DataScope for Prisma filtering.
    const scope = await resolveDataScope(req.user!);
    // Await side-effecting async work.
    await loadScopedLocation(scope, req.params.id, {
      // Pass kind through.
      kind,
      // Pass notFoundMessage through.
      notFoundMessage,
    });
    // Await async work into location.
    const location = await markRoomDirty(
      // Pass req.params.id through.
      req.params.id,
      // Continue the controller logic.
      req.user!.employeeId,
    );
    // JSON success response with the payload.
    return res.json(mapLocation(location));
  }

  // Return value or early exit.
  return { list, get, markDirty };
}
