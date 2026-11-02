/** Shared list/get/mark-dirty handlers parameterized by location kind. */
import type { Request, Response } from "express";
import { LocationKind } from "@prisma/client";
import { z } from "zod/v3";
import { markRoomDirty } from "../services/cleaning";
import {
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  DEFAULT_ACTIVE_LOCATION_LIMIT,
  MAX_ACTIVE_LOCATION_LIMIT,
  findActiveLocations,
  loadScopedLocation,
  mapLocation,
} from "../services/locations";

/** Build room / common-area controllers that differ only by kind + 404 label. */
export function createLocationKindController(
  kind: LocationKind,
  notFoundMessage: string,
) {
  async function list(req: Request, res: Response) {
    const parsed = z
      .object({
        limit: z.coerce
          .number()
          .int()
          .positive()
          .max(MAX_ACTIVE_LOCATION_LIMIT)
          .optional(),
        cursor: z.string().min(1).max(2048).optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const scope = await resolveDataScope(req.user!);
    const { rows, truncated, nextCursor } = await findActiveLocations(
      kind,
      locationWhere(scope),
      {
        limit: parsed.data.limit ?? DEFAULT_ACTIVE_LOCATION_LIMIT,
        cursor: parsed.data.cursor,
      },
    );
    if (truncated) res.setHeader("X-Result-Truncated", "1");
    if (nextCursor) res.setHeader("X-Next-Cursor", nextCursor);
    return res.json(rows.map(mapLocation));
  }

  async function get(req: Request, res: Response) {
    const scope = await resolveDataScope(req.user!);
    const location = await loadScopedLocation(scope, req.params.id, {
      kind,
      notFoundMessage,
    });
    return res.json(mapLocation(location));
  }

  async function markDirty(req: Request, res: Response) {
    const scope = await resolveDataScope(req.user!);
    await loadScopedLocation(scope, req.params.id, {
      kind,
      notFoundMessage,
    });
    const location = await markRoomDirty(
      req.params.id,
      req.user!.employeeId,
    );
    return res.json(mapLocation(location));
  }

  return { list, get, markDirty };
}
