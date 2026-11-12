/** Paginated cleaning results report for a hotel-date range (DataScope-filtered). */
import type { Request, Response } from "express";
// Import dependency zod/v3.
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
    // Provide from for the object/call below.
    from: z
      // Require a string value in the schema.
      .string()
      // Continue the fluent chain.
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      // Allow the field to be omitted.
      .optional()
      // Supply a default when the field is missing.
      .default(today),
    // Provide to for the object/call below.
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
    // Provide serviceType for the object/call below.
    serviceType: z
      // Continue the fluent chain.
      .union([
        // Pass serviceTypeEnum through.
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
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Reject inverted date ranges.
  if (parsed.data.from > parsed.data.to) {
    // Validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide message for the object/call below.
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
  // Branch: conditional gate.
  if (rawTypes !== undefined) {
    // Bind list for use in the handler below.
    const list = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
    // Zod field / transform.
    const checked = z.array(serviceTypeEnum).safeParse(list);
    // Branch: conditional gate.
    if (!checked.success) {
      // Validation error response.
      return res.status(400).json({
        // Provide error for the object/call below.
        error: "validation",
        // Provide details for the object/call below.
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
    // Provide from for the object/call below.
    from: parsed.data.from,
    // Provide to for the object/call below.
    to: parsed.data.to,
    // Provide page for the object/call below.
    page: parsed.data.page,
    // Provide pageSize for the object/call below.
    pageSize: parsed.data.pageSize,
    // Pass serviceTypes through.
    serviceTypes,
    // Provide sessionWhere for the object/call below.
    sessionWhere: sessionTaskWhere(scope),
    // Provide taskWhere for the object/call below.
    taskWhere: taskWhere(scope),
  });
  // JSON success response.
  return res.json(result);
}
