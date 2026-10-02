import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../errors";
import {
  assertCanAccessSector,
  assertCanCreateSector,
  resolveDataScope,
  sectorWhere,
} from "../services/dataScope";
import {
  createSector,
  createShift,
  getSector,
  listMySectors,
  listSectors,
  listShifts,
  setSectorLocations,
  updateSector,
  updateShift,
} from "../services/sectors";

export const sectorsRouter = Router();
export const shiftsRouter = Router();

const hhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const OUT_OF_SCOPE = "Outside your permitted data scope";

sectorsRouter.get("/", requireAuth, requireAction("sectors.manage"), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const scope = await resolveDataScope(req.user!);
    const sectors = await listSectors(includeInactive, sectorWhere(scope));
    return res.json(sectors);
  } catch (err) {
    return next(err);
  }
});

sectorsRouter.get("/mine", requireAuth, async (req, res, next) => {
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
});

sectorsRouter.get(
  "/:id",
  requireAuth,
  requireAction("sectors.manage"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessSector(scope, req.params.id);
      const sector = await getSector(req.params.id);
      return res.json(sector);
    } catch (err) {
      return next(err);
    }
  },
);

sectorsRouter.post(
  "/",
  requireAuth,
  requireAction("sectors.manage"),
  async (req, res, next) => {
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
      const primarySupervisorEmployeeId =
        scope.kind === "sectors"
          ? scope.employeeId
          : parsed.data.primarySupervisorEmployeeId;
      assertCanCreateSector(scope, primarySupervisorEmployeeId);

      const sector = await createSector({
        ...parsed.data,
        primarySupervisorEmployeeId,
        actorEmployeeId: req.user!.employeeId,
      });
      return res.status(201).json(sector);
    } catch (err) {
      return next(err);
    }
  },
);

sectorsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("sectors.manage"),
  async (req, res, next) => {
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
  },
);

sectorsRouter.put(
  "/:id/locations",
  requireAuth,
  requireAction("sectors.manage"),
  async (req, res, next) => {
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

      const sector = await setSectorLocations(
        req.params.id,
        parsed.data.locationIds,
        req.user!.employeeId,
      );
      return res.json(sector);
    } catch (err) {
      return next(err);
    }
  },
);

shiftsRouter.get("/", requireAuth, requireAction("shifts.manage"), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const shifts = await listShifts(includeInactive);
    return res.json(shifts);
  } catch (err) {
    return next(err);
  }
});

shiftsRouter.post(
  "/",
  requireAuth,
  requireAction("shifts.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        code: z.string().min(1).max(32),
        nameBg: z.string().min(1).max(120),
        nameEn: z.string().min(1).max(120),
        startTime: hhMm,
        endTime: hhMm,
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const shift = await createShift(parsed.data);
      return res.status(201).json(shift);
    } catch (err) {
      return next(err);
    }
  },
);

shiftsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("shifts.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        code: z.string().min(1).max(32).optional(),
        nameBg: z.string().min(1).max(120).optional(),
        nameEn: z.string().min(1).max(120).optional(),
        startTime: hhMm.optional(),
        endTime: hhMm.optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const shift = await updateShift(req.params.id, parsed.data);
      return res.json(shift);
    } catch (err) {
      return next(err);
    }
  },
);
