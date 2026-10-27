/**
 * Shift catalog and daily roster. GET / is auth-only but further checks
 * plan.manage / cleaning.create / cleaning.reassign / shifts.manage inside.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import { AppError } from "../errors";
import { canPerform } from "../services/roleGrants";
import {
  createShift,
  listShiftRoster,
  listShifts,
  updateShift,
  upsertShiftRoster,
} from "../services/shifts";

/** HH:MM 24h clock for shift start/end. */
const hhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Hotel calendar date YYYY-MM-DD. */
const hotelDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * List shifts. includeInactive requires shifts.manage; otherwise the caller
 * needs at least one of shifts.manage, plan.manage, cleaning.create, cleaning.reassign.
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const includeInactive = req.query.includeInactive === "true";
    const role = req.user!.role;
    // Permission / capability gate.
    const canCatalog = await canPerform(role, "shifts.manage");
    // Inactive rows are admin-only.
    if (includeInactive && !canCatalog) {
      // Throw error path.
      throw new AppError(403, "forbidden", "shifts.manage required");
    }
    // Active list is allowed for plan/cleaning flows that need shift pickers.
    if (
      !canCatalog &&
      !(await canPerform(role, "plan.manage")) &&
      !(await canPerform(role, "cleaning.create")) &&
      !(await canPerform(role, "cleaning.reassign"))
    ) {
      // Throw error path.
      throw new AppError(403, "forbidden", "Not allowed to list shifts");
    }
    const shifts = await listShifts(includeInactive);
    // JSON success response.
    return res.json(shifts);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /shifts/roster — roster for a required hotelDate query. */
export async function listRoster(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const hotelDate = hotelDateSchema.safeParse(req.query.hotelDate);
    // Branch: conditional gate.
    if (!hotelDate.success) {
      // Validation error response.
      return res.status(400).json({
        error: "validation",
        message: "hotelDate query (YYYY-MM-DD) is required",
      });
    }
    const roster = await listShiftRoster(hotelDate.data);
    // JSON success response.
    return res.json(roster);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PUT /shifts/roster — replace roster entries for a hotel date. */
export async function upsertRoster(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      hotelDate: hotelDateSchema,
      entries: z.array(
        z.object({
          employeeId: z.string().min(1),
          shiftId: z.string().min(1),
        }),
      ),
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
    const roster = await upsertShiftRoster({
      ...parsed.data,
      actorEmployeeId: req.user!.employeeId,
    });
    // JSON success response.
    return res.json(roster);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /shifts — create a shift definition. */
export async function create(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      code: z.string().min(1).max(32),
      nameBg: z.string().min(1).max(120),
      nameEn: z.string().min(1).max(120),
      startTime: hhMm,
      endTime: hhMm,
      sortOrder: z.number().int().min(0).max(9999).optional(),
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
    const shift = await createShift(parsed.data);
    // Return value / early exit.
    return res.status(201).json(shift);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PATCH /shifts/:id — update a shift definition. */
export async function update(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      code: z.string().min(1).max(32).optional(),
      nameBg: z.string().min(1).max(120).optional(),
      nameEn: z.string().min(1).max(120).optional(),
      startTime: hhMm.optional(),
      endTime: hhMm.optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
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
    const shift = await updateShift(req.params.id, parsed.data);
    // JSON success response.
    return res.json(shift);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
