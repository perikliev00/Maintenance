/** Paginated cleaning results report for a hotel-date range (DataScope-filtered). */
import type { Request, Response } from "express";
import { z } from "zod/v3";
import { getCleaningResults } from "../../services/cleaningResults";
import {
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
} from "../../services/dataScope";
import { todayHotelDateYmd } from "../../services/hotelTime";

/** GET /cleaning/results — paginated results for from/to (defaults to today). */
export async function get(req: Request, res: Response) {
  // Default date window is the current hotel calendar day.
  const today = await todayHotelDateYmd();
  // Zod field / transform.
  const serviceTypeEnum = z.enum([
    "stayover",
    "departure",
    "arrival",
    "common_area",
  ]);
  // Zod schema for request shape.
  const schema = z.object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .default(today),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .default(today),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
    serviceType: z
      .union([
        serviceTypeEnum,
        z.string().transform((s) => s.split(",").map((x) => x.trim())),
      ])
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
  let serviceTypes: Array<
    "stayover" | "departure" | "arrival" | "common_area"
  > | undefined;
  // Branch: conditional gate.
  if (rawTypes !== undefined) {
    const list = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
    // Zod field / transform.
    const checked = z.array(serviceTypeEnum).safeParse(list);
    // Branch: conditional gate.
    if (!checked.success) {
      // Validation error response.
      return res.status(400).json({
        error: "validation",
        details: checked.error.flatten(),
      });
    }
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
