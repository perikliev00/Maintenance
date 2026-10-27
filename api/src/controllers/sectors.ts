/**
 * Sector admin and /mine. Creating/updating location memberships respect
 * DataScope; sectors.transfer_cross allows assigning locations outside scope.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import { AppError } from "../errors";
import { canPerform } from "../services/roleGrants";
import {
  assertCanAccessSector,
  assertCanCreateSector,
  assertLocationsInSectorScope,
  resolveDataScope,
  sectorWhere,
} from "../services/dataScope";
import {
  createSector,
  getSector,
  listMySectors,
  listSectors,
  setSectorLocations,
  updateSector,
} from "../services/sectors";

/** Shared 403 message when a sector-scoped actor tries to expand scope. */
const OUT_OF_SCOPE = "Outside your permitted data scope";

/** GET /sectors — admin list (scoped; optional includeInactive). */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const includeInactive = req.query.includeInactive === "true";
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    const sectors = await listSectors(includeInactive, sectorWhere(scope));
    // JSON success response.
    return res.json(sectors);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** Compact list of sectors where the caller is primary supervisor (auth only). */
export async function listMine(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const sectors = await listMySectors(req.user!.employeeId);
    // Return a compact DTO (not the full admin sector payload).
    return res.json({
      count: sectors.length,
      sectors: sectors.map((s) => ({
        id: s.id,
        code: s.code,
        nameBg: s.nameBg,
        nameEn: s.nameEn,
        locationCount: s.locationCount,
      })),
    });
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /sectors/:id — single sector after scope access check. */
export async function get(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // Assert access / permission.
    await assertCanAccessSector(scope, req.params.id);
    const sector = await getSector(req.params.id);
    // JSON success response.
    return res.json(sector);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /sectors — create a sector (hotel-wide actors only). */
export async function create(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      propertyId: z.string().min(1).optional(),
      code: z.string().min(1).max(32),
      nameBg: z.string().min(1).max(120),
      nameEn: z.string().min(1).max(120),
      primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
      locationIds: z.array(z.string().min(1)).optional(),
      isActive: z.boolean().optional(),
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

    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // Sector-scoped actors cannot create sectors (would expand their data scope).
    if (scope.kind === "sectors") {
      // Throw error path.
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }

    const primarySupervisorEmployeeId =
      parsed.data.primarySupervisorEmployeeId;
    // Validate supervisor assignment against scope rules.
    assertCanCreateSector(scope, primarySupervisorEmployeeId);

    // Cross-sector location assignment requires an extra action grant.
    const allowCrossSectorTransfer = await canPerform(
      req.user!.role,
      "sectors.transfer_cross",
    );

    // Without transfer_cross, all locationIds must already be in scope.
    if (parsed.data.locationIds?.length && !allowCrossSectorTransfer) {
      // Await async step.
      await assertLocationsInSectorScope(scope, parsed.data.locationIds);
    }

    const sector = await createSector({
      ...parsed.data,
      primarySupervisorEmployeeId,
      actorEmployeeId: req.user!.employeeId,
      scope,
      allowCrossSectorTransfer,
    });
    // Return value / early exit.
    return res.status(201).json(sector);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PATCH /sectors/:id — update metadata; sector-scoped actors cannot reassign supervisor away. */
export async function update(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      code: z.string().min(1).max(32).optional(),
      nameBg: z.string().min(1).max(120).optional(),
      nameEn: z.string().min(1).max(120).optional(),
      primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
      isActive: z.boolean().optional(),
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

    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // Assert access / permission.
    await assertCanAccessSector(scope, req.params.id);

    // Sector-scoped supervisors cannot hand the sector to someone else.
    if (scope.kind === "sectors") {
      const nextSupervisor = parsed.data.primarySupervisorEmployeeId;
      // Branch: conditional gate.
      if (
        nextSupervisor !== undefined &&
        nextSupervisor !== scope.employeeId
      ) {
        // Throw error path.
        throw new AppError(403, "forbidden", OUT_OF_SCOPE);
      }
    }

    const sector = await updateSector(req.params.id, {
      ...parsed.data,
      actorEmployeeId: req.user!.employeeId,
    });
    // JSON success response.
    return res.json(sector);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PUT /sectors/:id/locations — replace sector location membership. */
export async function setLocations(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      locationIds: z.array(z.string().min(1)),
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

    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // Assert access / permission.
    await assertCanAccessSector(scope, req.params.id);

    const allowCrossSectorTransfer = await canPerform(
      req.user!.role,
      "sectors.transfer_cross",
    );
    // Without transfer_cross, reject locations outside the actor's scope.
    if (!allowCrossSectorTransfer) {
      // Await async step.
      await assertLocationsInSectorScope(scope, parsed.data.locationIds);
    }

    const sector = await setSectorLocations(
      req.params.id,
      parsed.data.locationIds,
      {
        actorEmployeeId: req.user!.employeeId,
        scope,
        allowCrossSectorTransfer,
      },
    );
    // JSON success response.
    return res.json(sector);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
