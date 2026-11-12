/**
 * Sector admin and /mine. Creating/updating location memberships respect
 * DataScope; sectors.transfer_cross allows assigning locations outside scope.
 * PATCH accepts optional locationIds for an atomic metadata+membership save.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
// Import local module ../errors.
import { AppError } from "../errors";
// Import local module ../services/roleGrants.
import { canPerform } from "../services/roleGrants";
// Continue named import list.
import {
  // Bring assertCanAccessSector into scope from the import.
  assertCanAccessSector,
  // Bring assertCanCreateSector into scope from the import.
  assertCanCreateSector,
  // Bring assertLocationsInSectorScope into scope from the import.
  assertLocationsInSectorScope,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring sectorWhere into scope from the import.
  sectorWhere,
} from "../services/dataScope";
// Continue named import list.
import {
  // Bring createSector into scope from the import.
  createSector,
  // Bring getSector into scope from the import.
  getSector,
  // Bring listMySectors into scope from the import.
  listMySectors,
  // Bring listSectors into scope from the import.
  listSectors,
  // Bring saveSector into scope from the import.
  saveSector,
  // Bring setSectorLocations into scope from the import.
  setSectorLocations,
} from "../services/sectors";

/** Shared 403 message when a sector-scoped actor tries to expand scope. */
const OUT_OF_SCOPE = "Outside your permitted data scope";

// Zod schema optionalTrimmed for request validation.
const optionalTrimmed = z
  // Require a string value in the schema.
  .string()
  // Continue the fluent chain.
  .transform((s) => s.trim())
  // Continue the fluent chain.
  .pipe(z.string().min(1).max(120));

// Zod schema optionalCode for request validation.
const optionalCode = z
  // Require a string value in the schema.
  .string()
  // Continue the fluent chain.
  .transform((s) => s.trim())
  // Continue the fluent chain.
  .pipe(z.string().min(1).max(32));

/** GET /sectors — admin list (scoped; optional includeInactive). */
export async function list(req: Request, res: Response) {
  const includeInactive = req.query.includeInactive === "true";
  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  const sectors = await listSectors(includeInactive, sectorWhere(scope));
  // JSON success response with the payload.
  return res.json(sectors);
}

/** Compact list of sectors where the caller is primary supervisor (auth only). */
export async function listMine(req: Request, res: Response) {
  const sectors = await listMySectors(req.user!.employeeId);
  // JSON success response with the payload.
  return res.json({
    count: sectors.length,
    // Continue the controller logic.
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
  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessSector(scope, req.params.id);
  const sector = await getSector(req.params.id);
  // JSON success response with the payload.
  return res.json(sector);
}

/** POST /sectors — create a sector (hotel-wide actors only). */
export async function create(req: Request, res: Response) {
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field propertyId.
    propertyId: z.string().min(1).optional(),
    code: optionalCode,
    nameBg: optionalTrimmed,
    nameEn: optionalTrimmed,
    // Validate field primarySupervisorEmployeeId.
    primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
    // Validate field locationIds.
    locationIds: z.array(z.string().min(1)).optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
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

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Sector-scoped actors cannot create sectors (would expand their data scope).
  if (scope.kind === "sectors") {
    // Abort with an application/HTTP error.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  const primarySupervisorEmployeeId =
    // Continue the controller logic.
    parsed.data.primarySupervisorEmployeeId;
  // Continue the controller logic.
  assertCanCreateSector(scope, primarySupervisorEmployeeId);

  const allowCrossSectorTransfer = await canPerform(
    // Continue the controller logic.
    req.user!.role,
    // Pass string literal argument.
    "sectors.transfer_cross",
  );

  // Branch when this condition holds.
  if (parsed.data.locationIds?.length && !allowCrossSectorTransfer) {
    // Await side-effecting async work.
    await assertLocationsInSectorScope(scope, parsed.data.locationIds);
  }

  const sector = await createSector({
    // Continue the controller logic.
    ...parsed.data,
    primarySupervisorEmployeeId,
    actorEmployeeId: req.user!.employeeId,
    scope,
    allowCrossSectorTransfer,
  });
  // Created response with the new resource body.
  return res.status(201).json(sector);
}

/**
 * PATCH /sectors/:id — atomic metadata (+ optional locationIds) save.
 * Sector-scoped actors cannot reassign supervisor away from themselves.
 */
export async function update(req: Request, res: Response) {
  // Zod schema schema for request validation.
  const schema = z.object({
    code: optionalCode.optional(),
    nameBg: optionalTrimmed.optional(),
    nameEn: optionalTrimmed.optional(),
    // Validate field primarySupervisorEmployeeId.
    primarySupervisorEmployeeId: z.string().min(1).nullable().optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
    // Validate field locationIds.
    locationIds: z.array(z.string().min(1)).optional(),
    /** Required on public PATCH — optimistic concurrency (BUG-07). */
    expectedVersion: z.number().int().positive(),
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

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessSector(scope, req.params.id);

  // Branch when this condition holds.
  if (scope.kind === "sectors") {
    const nextSupervisor = parsed.data.primarySupervisorEmployeeId;
    // Branch when this condition holds.
    if (
      // Continue the controller logic.
      nextSupervisor !== undefined &&
      // Continue the controller logic.
      nextSupervisor !== scope.employeeId
    // Continue the controller logic.
    ) {
      // Abort with an application/HTTP error.
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }
  }

  const allowCrossSectorTransfer = await canPerform(
    // Continue the controller logic.
    req.user!.role,
    // Pass string literal argument.
    "sectors.transfer_cross",
  );

  // Branch when this condition holds.
  if (
    // Continue the controller logic.
    parsed.data.locationIds?.length &&
    // Continue the controller logic.
    !allowCrossSectorTransfer
  // Continue the controller logic.
  ) {
    // Await side-effecting async work.
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
  // JSON success response with the payload.
  return res.json(sector);
}

/** PUT /sectors/:id/locations — replace sector location membership. */
export async function setLocations(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field locationIds.
    locationIds: z.array(z.string().min(1)),
    /** Required on public PUT — optimistic concurrency (BUG-07). */
    expectedVersion: z.number().int().positive(),
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

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessSector(scope, req.params.id);

  const allowCrossSectorTransfer = await canPerform(
    // Continue the controller logic.
    req.user!.role,
    // Pass string literal argument.
    "sectors.transfer_cross",
  );
  // Guard: skip or fail when the negated condition holds.
  if (!allowCrossSectorTransfer) {
    // Await side-effecting async work.
    await assertLocationsInSectorScope(scope, parsed.data.locationIds);
  }

  const sector = await setSectorLocations(
    // Pass req.params.id through.
    req.params.id,
    // Pass parsed.data.locationIds through.
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
  // JSON success response with the payload.
  return res.json(sector);
}
