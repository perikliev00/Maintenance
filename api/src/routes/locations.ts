import { Router } from "express";
import { z } from "zod";
import {
  LocationKind,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";
import { requireAuth, requireAction } from "../middleware/auth";
import {
  assertCanAccessLocation,
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  archiveLocation,
  createLocation,
  findLocationById,
  findLocationByQrToken,
  getLocationHierarchy,
  listLocationsCatalog,
  locationQrPayload,
  mapLocation,
  restoreLocation,
  setLocationOccupancy,
  setLocationServiceStatus,
  updateLocation,
} from "../services/locations";

export const locationsRouter = Router();

const kindSchema = z.enum(["room", "common_area"]);
const occupancySchema = z.enum(["vacant", "occupied", "unknown"]);
const serviceStatusSchema = z.enum([
  "in_service",
  "out_of_service",
  "unknown",
]);

/** Resolve a room/common-area QR token to location identity (no auto start). */
locationsRouter.get(
  "/by-qr/:token",
  requireAuth,
  requireAction("rooms.view"),
  async (req, res, next) => {
    try {
      const location = await findLocationByQrToken(req.params.token);
      if (!location || location.catalogStatus !== "active") {
        return res.status(404).json({
          error: "not_found",
          message: "Unknown or inactive location QR",
        });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessLocation(scope, location.id);
      return res.json({
        location: mapLocation(location),
        qr: locationQrPayload(location),
      });
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.get(
  "/hierarchy",
  requireAuth,
  requireAction("rooms.manage"),
  async (_req, res, next) => {
    try {
      return res.json(await getLocationHierarchy());
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.get(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  async (req, res, next) => {
    try {
      const kindParsed = kindSchema.optional().safeParse(req.query.kind);
      if (!kindParsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: kindParsed.error.flatten() });
      }
      const includeArchived = req.query.includeArchived === "true";
      const scope = await resolveDataScope(req.user!);
      const locations = await listLocationsCatalog({
        kind: kindParsed.data as LocationKind | undefined,
        includeArchived,
        scopeFilter: locationWhere(scope),
      });
      return res.json(locations.map(mapLocation));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.post(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        floorId: z.string().min(1),
        number: z.string().min(1).max(64),
        kind: kindSchema.optional(),
        occupancy: occupancySchema.optional(),
        serviceStatus: serviceStatusSchema.optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const location = await createLocation({
        floorId: parsed.data.floorId,
        number: parsed.data.number,
        kind: parsed.data.kind as LocationKind | undefined,
        occupancy: parsed.data.occupancy as Occupancy | undefined,
        serviceStatus: parsed.data.serviceStatus as ServiceStatus | undefined,
        actorEmployeeId: req.user!.employeeId,
      });
      return res.status(201).json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.patch(
  "/:id/occupancy",
  requireAuth,
  requireAction("rooms.set_occupancy"),
  async (req, res, next) => {
    try {
      const schema = z.object({ occupancy: occupancySchema });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      const existing = await findLocationById(req.params.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: "not_found", message: "Location not found" });
      }
      await assertCanAccessLocation(scope, existing.id);

      const location = await setLocationOccupancy(
        req.params.id,
        parsed.data.occupancy as Occupancy,
        req.user!.employeeId,
      );
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.patch(
  "/:id/service-status",
  requireAuth,
  requireAction("rooms.set_service_status"),
  async (req, res, next) => {
    try {
      const schema = z.object({ serviceStatus: serviceStatusSchema });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      const existing = await findLocationById(req.params.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: "not_found", message: "Location not found" });
      }
      await assertCanAccessLocation(scope, existing.id);

      const location = await setLocationServiceStatus(
        req.params.id,
        parsed.data.serviceStatus as ServiceStatus,
        req.user!.employeeId,
      );
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.post(
  "/:id/archive",
  requireAuth,
  requireAction("rooms.manage"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      const existing = await findLocationById(req.params.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: "not_found", message: "Location not found" });
      }
      await assertCanAccessLocation(scope, existing.id);
      const location = await archiveLocation(
        req.params.id,
        req.user!.employeeId,
      );
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.post(
  "/:id/restore",
  requireAuth,
  requireAction("rooms.manage"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      const existing = await findLocationById(req.params.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: "not_found", message: "Location not found" });
      }
      await assertCanAccessLocation(scope, existing.id);
      const location = await restoreLocation(
        req.params.id,
        req.user!.employeeId,
      );
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.get(
  "/:id/qr",
  requireAuth,
  requireAction("sectors.manage"),
  async (req, res, next) => {
    try {
      const location = await findLocationById(req.params.id);
      if (!location || location.catalogStatus !== "active") {
        return res.status(404).json({
          error: "not_found",
          message: "Location not found",
        });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessLocation(scope, location.id);
      return res.json(locationQrPayload(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("rooms.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        floorId: z.string().min(1).optional(),
        number: z.string().min(1).max(64).optional(),
        kind: kindSchema.optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      if (
        parsed.data.floorId === undefined &&
        parsed.data.number === undefined &&
        parsed.data.kind === undefined
      ) {
        return res.status(400).json({
          error: "validation",
          message: "At least one of floorId, number, kind is required",
        });
      }

      const scope = await resolveDataScope(req.user!);
      const existing = await findLocationById(req.params.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: "not_found", message: "Location not found" });
      }
      await assertCanAccessLocation(scope, existing.id);

      const location = await updateLocation(req.params.id, {
        floorId: parsed.data.floorId,
        number: parsed.data.number,
        kind: parsed.data.kind as LocationKind | undefined,
        actorEmployeeId: req.user!.employeeId,
      });
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);
