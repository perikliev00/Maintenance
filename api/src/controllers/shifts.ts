/**
 * Shift catalog and daily roster. GET / is auth-only but further checks
 * plan.manage / cleaning.create / cleaning.reassign / shifts.manage inside.
 */
import type { Request, Response } from "express";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Import local module ../errors.
import { AppError } from "../errors";
// Import local module ../services/roleGrants.
import { canPerform } from "../services/roleGrants";
// Continue named import list.
import {
  // Bring createShift into scope from the import.
  createShift,
  // Bring listShiftRoster into scope from the import.
  listShiftRoster,
  // Bring listShifts into scope from the import.
  listShifts,
  // Bring updateShift into scope from the import.
  updateShift,
  // Bring upsertShiftRoster into scope from the import.
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
export async function list(req: Request, res: Response) {
  // Bind includeInactive for use in the handler below.
  const includeInactive = req.query.includeInactive === "true";
  // Bind role for use in the handler below.
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
    // Continue the controller logic.
    !canCatalog &&
    // Continue the controller logic.
    !(await canPerform(role, "plan.manage")) &&
    // Continue the controller logic.
    !(await canPerform(role, "cleaning.create")) &&
    // Continue the controller logic.
    !(await canPerform(role, "cleaning.reassign"))
  // Continue the controller logic.
  ) {
    // Throw error path.
    throw new AppError(403, "forbidden", "Not allowed to list shifts");
  }
  // Await async work into shifts.
  const shifts = await listShifts(includeInactive);
  // JSON success response.
  return res.json(shifts);
}

/** GET /shifts/roster — roster for a required hotelDate query. */
export async function listRoster(req: Request, res: Response) {
  // Bind hotelDate for use in the handler below.
  const hotelDate = hotelDateSchema.safeParse(req.query.hotelDate);
  // Branch: conditional gate.
  if (!hotelDate.success) {
    // Validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide message for the object/call below.
      message: "hotelDate query (YYYY-MM-DD) is required",
    });
  }
  // Await async work into roster.
  const roster = await listShiftRoster(hotelDate.data);
  // JSON success response.
  return res.json(roster);
}

/** PUT /shifts/roster — replace roster entries for a hotel date. */
export async function upsertRoster(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Provide hotelDate for the object/call below.
    hotelDate: hotelDateSchema,
    // Validate field entries.
    entries: z.array(
      // Continue the controller logic.
      z.object({
        // Validate field employeeId.
        employeeId: z.string().min(1),
        // Validate field shiftId.
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
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Await async work into roster.
  const roster = await upsertShiftRoster({
    // Continue the controller logic.
    ...parsed.data,
    // Provide actorEmployeeId for the object/call below.
    actorEmployeeId: req.user!.employeeId,
  });
  // JSON success response.
  return res.json(roster);
}

/** POST /shifts — create a shift definition. */
export async function create(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field code.
    code: z.string().min(1).max(32),
    // Validate field nameBg.
    nameBg: z.string().min(1).max(120),
    // Validate field nameEn.
    nameEn: z.string().min(1).max(120),
    // Provide startTime for the object/call below.
    startTime: hhMm,
    // Provide endTime for the object/call below.
    endTime: hhMm,
    // Validate field sortOrder.
    sortOrder: z.number().int().min(0).max(9999).optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Await async work into shift.
  const shift = await createShift(parsed.data);
  // Return value / early exit.
  return res.status(201).json(shift);
}

/** PATCH /shifts/:id — update a shift definition. */
export async function update(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field code.
    code: z.string().min(1).max(32).optional(),
    // Validate field nameBg.
    nameBg: z.string().min(1).max(120).optional(),
    // Validate field nameEn.
    nameEn: z.string().min(1).max(120).optional(),
    // Provide startTime for the object/call below.
    startTime: hhMm.optional(),
    // Provide endTime for the object/call below.
    endTime: hhMm.optional(),
    // Validate field sortOrder.
    sortOrder: z.number().int().min(0).max(9999).optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Await async work into shift.
  const shift = await updateShift(req.params.id, parsed.data);
  // JSON success response.
  return res.json(shift);
}
