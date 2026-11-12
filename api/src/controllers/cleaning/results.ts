/** Paginated cleaning results report for a hotel-date range (DataScope-filtered). */
import type { Request, Response } from "express";
import { z } from "zod/v3";
// Import local module ../../services/cleaningResults.
import { getCleaningResults } from "../../services/cleaningResults";
// Continue named import list.
import {
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring sessionTaskWhere into scope from the import.
  sessionTaskWhere,
  // Bring taskWhere into scope from the import.
  taskWhere,
} from "../../services/dataScope";
// Import local module ../../services/hotelTime.
import { todayHotelDateYmd } from "../../services/hotelTime";

/** GET /cleaning/results — paginated results for from/to (defaults to today). */
export async function get(req: Request, res: Response) {
  // Default date window is the current hotel calendar day.
  const today = await todayHotelDateYmd();
  // Zod field / transform.
  const serviceTypeEnum = z.enum([
    // Pass string literal argument.
    "stayover",
    // Pass string literal argument.
    "departure",
    // Pass string literal argument.
    "arrival",
    // Pass string literal argument.
    "common_area",
  ]);
  // Zod schema for request shape.
  const schema = z.object({
    from: z
      // Require a string value in the schema.
      .string()
      // Continue the fluent chain.
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      // Allow the field to be omitted.
      .optional()
      // Supply a default when the field is missing.
      .default(today),
    to: z
      // Require a string value in the schema.
      .string()
      // Continue the fluent chain.
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      // Allow the field to be omitted.
      .optional()
      // Supply a default when the field is missing.
      .default(today),
    // Validate field page.
    page: z.coerce.number().int().min(1).optional().default(1),
    // Validate field pageSize.
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
    serviceType: z
      // Continue the fluent chain.
      .union([
        serviceTypeEnum,
        // Continue the controller logic.
        z.string().transform((s) => s.split(",").map((x) => x.trim())),
      ])
      // Allow the field to be omitted.
      .optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.query);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Validation error response.
    return res.status(400).json({
      error: "validation",
      details: parsed.error.flatten(),
    });
  }
  // Reject inverted date ranges.
  if (parsed.data.from > parsed.data.to) {
    // Validation error response.
    return res.status(400).json({
      error: "validation",
      message: "`from` must be on or before `to`",
    });
  }

  // Normalize single/comma-separated serviceType into a typed array.
  const rawTypes = parsed.data.serviceType;
  // Continue the controller logic.
  let serviceTypes: Array<
    // Pass string literal argument.
    "stayover" | "departure" | "arrival" | "common_area"
  // Continue the controller logic.
  > | undefined;
  if (rawTypes !== undefined) {
    const list = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
    // Zod field / transform.
    const checked = z.array(serviceTypeEnum).safeParse(list);
    if (!checked.success) {
      // Validation error response.
      return res.status(400).json({
        error: "validation",
        details: checked.error.flatten(),
      });
    }
    // Continue the controller logic.
    serviceTypes = checked.data;
  }

  // Scope filters so sector-limited users only see their results.
  const scope = await resolveDataScope(req.user!);
  // Capture service / command result.
  const result = await getCleaningResults({
    from: parsed.data.from,
    to: parsed.data.to,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    serviceTypes,
    sessionWhere: sessionTaskWhere(scope),
    taskWhere: taskWhere(scope),
  });
  // JSON success response.
  return res.json(result);
}
