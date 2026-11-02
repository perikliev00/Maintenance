/**
 * Sector admin and /mine. Creating/updating location memberships respect
 * DataScope; sectors.transfer_cross allows assigning locations outside scope.
 * PATCH accepts optional locationIds for an atomic metadata+membership save.
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
  saveSector,
  setSectorLocations,
} from "../services/sectors";

/** Shared 403 message when a sector-scoped actor tries to expand scope. */
const OUT_OF_SCOPE = "Outside your permitted data scope";

const optionalTrimmed = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(120));

const optionalCode = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(32));

/** GET /sectors — admin list (scoped; optional includeInactive). */
export async function list(req: Request, res: Response) {
  const includeInactive = req.query.includeInactive === "true";
  const scope = await resolveDataScope(req.user!);
  const sectors = await listSectors(includeInactive, sectorWhere(scope));
  return res.json(sectors);
}

/** Compact list of sectors where the caller is primary supervisor (auth only). */
export async function listMine(req: Request, res: Response) {
  const sectors = await listMySectors(req.user!.employeeId);
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
}

/** GET /sectors/:id — single sector after scope access check. */
export async function get(req: Request, res: Response) {
  const scope = await resolveDataScope(req.user!);
  await assertCanAccessSector(scope, req.params.id);
  const sector = await getSector(req.params.id);
  return res.json(sector);
}

/** POST /sectors — create a sector (hotel-wide actors only). */
export async function create(req: Request, res: Response) {
  const schema = z.object({
    propertyId: z.string().min(1).optional(),
    code: optionalCode,
    nameBg: optionalTrimmed,
    nameEn: optionalTrimmed,
    primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
    locationIds: z.array(z.string().min(1)).optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  const scope = await resolveDataScope(req.user!);
  // Sector-scoped actors cannot create sectors (would expand their data scope).
  if (scope.kind === "sectors") {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  const primarySupervisorEmployeeId =
    parsed.data.primarySupervisorEmployeeId;
  assertCanCreateSector(scope, primarySupervisorEmployeeId);

  const allowCrossSectorTransfer = await canPerform(
    req.user!.role,
    "sectors.transfer_cross",
  );

  if (parsed.data.locationIds?.length && !allowCrossSectorTransfer) {
    await assertLocationsInSectorScope(scope, parsed.data.locationIds);
  }

  const sector = await createSector({
    ...parsed.data,
    primarySupervisorEmployeeId,
    actorEmployeeId: req.user!.employeeId,
    scope,
    allowCrossSectorTransfer,
  });
  return res.status(201).json(sector);
}

/**
 * PATCH /sectors/:id — atomic metadata (+ optional locationIds) save.
 * Sector-scoped actors cannot reassign supervisor away from themselves.
 */
export async function update(req: Request, res: Response) {
  const schema = z.object({
    code: optionalCode.optional(),
    nameBg: optionalTrimmed.optional(),
    nameEn: optionalTrimmed.optional(),
    primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
    locationIds: z.array(z.string().min(1)).optional(),
    /** Required on public PATCH — optimistic concurrency (BUG-07). */
    expectedVersion: z.number().int().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  const scope = await resolveDataScope(req.user!);
  await assertCanAccessSector(scope, req.params.id);

  if (scope.kind === "sectors") {
    const nextSupervisor = parsed.data.primarySupervisorEmployeeId;
    if (
      nextSupervisor !== undefined &&
      nextSupervisor !== scope.employeeId
    ) {
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }
  }

  const allowCrossSectorTransfer = await canPerform(
    req.user!.role,
    "sectors.transfer_cross",
  );

  if (
    parsed.data.locationIds?.length &&
    !allowCrossSectorTransfer
  ) {
    await assertLocationsInSectorScope(scope, parsed.data.locationIds);
  }

  const sector = await saveSector(req.params.id, {
    code: parsed.data.code,
    nameBg: parsed.data.nameBg,
    nameEn: parsed.data.nameEn,
    primarySupervisorEmployeeId: parsed.data.primarySupervisorEmployeeId,
    isActive: parsed.data.isActive,
    locationIds: parsed.data.locationIds,
    expectedVersion: parsed.data.expectedVersion,
    actor: {
      employeeId: req.user!.employeeId,
      userId: req.user!.userId,
      role: req.user!.role,
    },
    scope,
    allowCrossSectorTransfer,
  });
  return res.json(sector);
}

/** PUT /sectors/:id/locations — replace sector location membership. */
export async function setLocations(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const schema = z.object({
    locationIds: z.array(z.string().min(1)),
    /** Required on public PUT — optimistic concurrency (BUG-07). */
    expectedVersion: z.number().int().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  const scope = await resolveDataScope(req.user!);
  await assertCanAccessSector(scope, req.params.id);

  const allowCrossSectorTransfer = await canPerform(
    req.user!.role,
    "sectors.transfer_cross",
  );
  if (!allowCrossSectorTransfer) {
    await assertLocationsInSectorScope(scope, parsed.data.locationIds);
  }

  const sector = await setSectorLocations(
    req.params.id,
    parsed.data.locationIds,
    {
      actorEmployeeId: req.user!.employeeId,
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      scope,
      allowCrossSectorTransfer,
      expectedVersion: parsed.data.expectedVersion,
    },
  );
  return res.json(sector);
}
