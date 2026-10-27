/**
 * Daily housekeeping plan list/import/create/delete and departure-effect apply.
 * Reads/writes are limited by locationWhere / assertCanAccessLocation.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import { DailyPlanCategory } from "@prisma/client";
import { prisma } from "../db";
import { todayHotelDateYmd } from "../services/hotelTime";
import {
  applyDepartureRoomEffects,
  createDailyPlanEntry,
  deleteDailyPlanEntry,
  getDailyPlan,
  importDailyPlan,
} from "../services/dailyPlan";
import {
  assertCanAccessLocation,
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";

/** Hotel calendar date YYYY-MM-DD. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Body for apply-departure-effects (optional confirm list for deferred rows). */
const hotelDateBodySchema = z.object({
  hotelDate: dateSchema,
  confirmEntryIds: z.array(z.string().min(1)).max(500).optional(),
});

/** Bulk import payload: building/room rows for one hotel date. */
const importSchema = z.object({
  hotelDate: dateSchema,
  sourceLabel: z.string().min(1).max(100).default("clock"),
  entries: z
    .array(
      z.object({
        buildingCode: z.string().min(1).max(32),
        roomNumber: z.string().min(1).max(32),
        category: z.nativeEnum(DailyPlanCategory),
        notes: z.string().max(500).optional(),
        externalId: z.string().min(1).max(200).optional(),
      }),
    )
    .max(2000),
});

/** GET /daily-plan — plan for hotelDate (defaults to today in hotel TZ). */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Default to today's hotel date when query omits hotelDate.
    const hotelDate =
      typeof req.query.hotelDate === "string"
        ? req.query.hotelDate
        : await todayHotelDateYmd();
    // Parse and validate input.
    const parsed = dateSchema.safeParse(hotelDate);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Validation error response.
      return res.status(400).json({
        error: "validation",
        message: "hotelDate must be YYYY-MM-DD",
      });
    }
    // Scope filter so sector-limited users only see their locations.
    const scope = await resolveDataScope(req.user!);
    const plan = await getDailyPlan(parsed.data, locationWhere(scope));
    // JSON success response.
    return res.json(plan);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /apply-departure-effects — apply/confirm deferred vacant+dirty. */
export async function applyDepartureEffects(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // Parse and validate input.
    const parsed = hotelDateBodySchema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // confirmEntryIds lets ops vacate ambiguous past occupied rooms.
    const result = await applyDepartureRoomEffects(
      parsed.data.hotelDate,
      locationWhere(scope),
      { confirmEntryIds: parsed.data.confirmEntryIds },
    );
    // JSON success response.
    return res.json(result);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /import — bulk import plan rows (max 2000). */
export async function importPlan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // Parse and validate input.
    const parsed = importSchema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Branch: conditional gate.
    if (!req.user) {
      // Return value / early exit.
      return res
        .status(401)
        .json({ error: "unauthorized", message: "Missing user" });
    }

    // Build data-scope filter.
    const scope = await resolveDataScope(req.user);
    // Import only writes locations inside the caller's scope.
    const result = await importDailyPlan(
      parsed.data,
      req.user.employeeId,
      locationWhere(scope),
    );
    // Return value / early exit.
    return res.status(201).json(result);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST / — create a single plan entry for a location in scope. */
export async function create(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      hotelDate: dateSchema,
      locationId: z.string().min(1),
      category: z.nativeEnum(DailyPlanCategory),
      notes: z.string().max(500).optional(),
      assignedEmployeeId: z.string().min(1).optional(),
      shiftId: z.string().min(1).nullable().optional(),
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
    // Branch: conditional gate.
    if (!req.user) {
      // Return value / early exit.
      return res
        .status(401)
        .json({ error: "unauthorized", message: "Missing user" });
    }

    // Build data-scope filter.
    const scope = await resolveDataScope(req.user);
    // Assert access / permission.
    await assertCanAccessLocation(scope, parsed.data.locationId);

    // Capture service / command result.
    const result = await createDailyPlanEntry({
      ...parsed.data,
      createdByEmployeeId: req.user.employeeId,
    });
    // Return value / early exit.
    return res.status(201).json(result);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** DELETE /:id — delete a plan entry after location scope check. */
export async function remove(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Load entry to get locationId for scope check.
    const existing = await prisma.dailyPlanEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, locationId: true },
    });
    // Branch: conditional gate.
    if (!existing) {
      // Return value / early exit.
      return res.status(404).json({
        error: "not_found",
        message: "Plan entry not found",
      });
    }
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // Assert access / permission.
    await assertCanAccessLocation(scope, existing.locationId);

    // Capture service / command result.
    const result = await deleteDailyPlanEntry(req.params.id);
    // JSON success response.
    return res.json(result);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
