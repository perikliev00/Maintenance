import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
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

const OUT_OF_SCOPE = "Outside your permitted data scope";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const scope = await resolveDataScope(req.user!);
    const sectors = await listSectors(includeInactive, sectorWhere(scope));
    return res.json(sectors);
  } catch (err) {
    return next(err);
  }
}

export async function listMine(req: Request, res: Response, next: NextFunction) {
  try {
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
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    await assertCanAccessSector(scope, req.params.id);
    const sector = await getSector(req.params.id);
    return res.json(sector);
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      propertyId: z.string().min(1).optional(),
      code: z.string().min(1).max(32),
      nameBg: z.string().min(1).max(120),
      nameEn: z.string().min(1).max(120),
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
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      code: z.string().min(1).max(32).optional(),
      nameBg: z.string().min(1).max(120).optional(),
      nameEn: z.string().min(1).max(120).optional(),
      primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
      isActive: z.boolean().optional(),
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

    const sector = await updateSector(req.params.id, {
      ...parsed.data,
      actorEmployeeId: req.user!.employeeId,
    });
    return res.json(sector);
  } catch (err) {
    return next(err);
  }
}

export async function setLocations(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({
      locationIds: z.array(z.string().min(1)),
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
        scope,
        allowCrossSectorTransfer,
      },
    );
    return res.json(sector);
  } catch (err) {
    return next(err);
  }
}
