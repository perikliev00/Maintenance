/**
 * Daily housekeeping plan list/import/create/delete and departure-effect apply.
 * Reads/writes are limited by locationWhere / assertCanAccessLocation.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import { DailyPlanCategory } from "@prisma/client";
// Import local module ../services/hotelTime.
import { todayHotelDateYmd } from "../services/hotelTime";
// Continue named import list.
import {
  // Bring applyDepartureRoomEffects into scope from the import.
  applyDepartureRoomEffects,
  // Bring createDailyPlanEntry into scope from the import.
  createDailyPlanEntry,
  // Bring deleteDailyPlanEntry into scope from the import.
  deleteDailyPlanEntry,
  // Bring getDailyPlan into scope from the import.
  getDailyPlan,
  // Bring importDailyPlan into scope from the import.
  importDailyPlan,
} from "../services/dailyPlan";
// Continue named import list.
import {
  // Bring assertCanAccessLocation into scope from the import.
  assertCanAccessLocation,
  // Bring locationWhere into scope from the import.
  locationWhere,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
} from "../services/dataScope";

/** Hotel calendar date YYYY-MM-DD. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Body for apply-departure-effects (optional confirm list for deferred rows). */
const hotelDateBodySchema = z.object({
  hotelDate: dateSchema,
  // Validate field confirmEntryIds.
  confirmEntryIds: z.array(z.string().min(1)).max(500).optional(),
});

/** Bulk import payload: building/room rows for one hotel date. */
const importSchema = z.object({
  hotelDate: dateSchema,
  // Validate field sourceLabel.
  sourceLabel: z.string().min(1).max(100).default("clock"),
  entries: z
    // Expect an array of elements.
    .array(
      // Continue the controller logic.
      z.object({
        // Validate field buildingCode.
        buildingCode: z.string().min(1).max(32),
        // Validate field roomNumber.
        roomNumber: z.string().min(1).max(32),
        // Validate field category.
        category: z.nativeEnum(DailyPlanCategory),
        // Validate field notes.
        notes: z.string().max(500).optional(),
        // Validate field externalId.
        externalId: z.string().min(1).max(200).optional(),
      }),
    )
    // Enforce maximum length/value constraint.
    .max(2000),
});

/** GET /daily-plan — plan for hotelDate (defaults to today in hotel TZ). */
export async function list(req: Request, res: Response) {
  // Default to today's hotel date when query omits hotelDate.
  const hotelDate =
    // Narrow the runtime type before using the value.
    typeof req.query.hotelDate === "string"
      // Continue the conditional expression.
      ? req.query.hotelDate
      // Continue the conditional expression.
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
}

/** POST /apply-departure-effects — apply/confirm deferred vacant+dirty. */
export async function applyDepartureEffects(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Parse and validate input.
  const parsed = hotelDateBodySchema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // confirmEntryIds lets ops vacate ambiguous past occupied rooms.
  const result = await applyDepartureRoomEffects(
    // Pass parsed.data.hotelDate through.
    parsed.data.hotelDate,
    // Continue the controller logic.
    locationWhere(scope),
    // Continue the controller logic.
    { confirmEntryIds: parsed.data.confirmEntryIds },
  );
  // JSON success response.
  return res.json(result);
}

/** POST /import — bulk import plan rows (max 2000). */
export async function importPlan(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Parse and validate input.
  const parsed = importSchema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  if (!req.user) {
    return res
      // Set response status code.
      .status(401)
      // Attach JSON body to the response.
      .json({ error: "unauthorized", message: "Missing user" });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user);
  // Import only writes locations inside the caller's scope.
  const result = await importDailyPlan(
    // Pass parsed.data through.
    parsed.data,
    // Pass req.user.employeeId through.
    req.user.employeeId,
    // Continue the controller logic.
    locationWhere(scope),
  );
  return res.status(201).json(result);
}

/** POST / — create a single plan entry for a location in scope. */
export async function create(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    hotelDate: dateSchema,
    // Validate field locationId.
    locationId: z.string().min(1),
    // Validate field category.
    category: z.nativeEnum(DailyPlanCategory),
    // Validate field notes.
    notes: z.string().max(500).optional(),
    // Validate field assignedEmployeeId.
    assignedEmployeeId: z.string().min(1).optional(),
    // Validate field shiftId.
    shiftId: z.string().min(1).nullable().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  if (!req.user) {
    return res
      // Set response status code.
      .status(401)
      // Attach JSON body to the response.
      .json({ error: "unauthorized", message: "Missing user" });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user);
  // Assert access / permission.
  await assertCanAccessLocation(scope, parsed.data.locationId);

  // Capture service / command result.
  const result = await createDailyPlanEntry({
    // Continue the controller logic.
    ...parsed.data,
    createdByEmployeeId: req.user.employeeId,
  });
  return res.status(201).json(result);
}

/** DELETE /:id — delete a plan entry after location scope check. */
export async function remove(req: Request, res: Response) {
  // Build data-scope filter; service owns lookup + access + delete.
  const scope = await resolveDataScope(req.user!);
  // Invoke service and capture the result payload.
  const result = await deleteDailyPlanEntry(req.params.id, scope);
  // JSON success response.
  return res.json(result);
}
