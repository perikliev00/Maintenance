/** Settings + SLA policy HTTP handlers (public subset vs settings.manage routes). */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import {
  ensureDefaultSettings,
  getAllSettings,
  getPublicSettings,
  getSystemStatus,
  listSettingHistory,
  updateSetting,
} from "../services/settings";
import {
  ensureDefaultSlaPolicies,
  listSlaPolicies as fetchSlaPolicies,
  upsertSlaPolicy,
} from "../services/slaPolicies";
import { AppError } from "../errors";
import { Priority } from "@prisma/client";

/** Non-sensitive settings any authenticated client may read (seeds defaults first). */
export async function getPublic(_req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Ensure seed rows exist before reading the public subset.
    await ensureDefaultSettings();
    // JSON success response.
    return res.json(await getPublicSettings());
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /settings — full settings map (settings.manage). */
export async function list(_req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(await getAllSettings());
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /settings/system — system/ops status block. */
export async function getSystem(_req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(await getSystemStatus());
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /settings/history — optional key filter and limit. */
export async function listHistory(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const limit =
      typeof req.query.limit === "string"
        ? Number.parseInt(req.query.limit, 10)
        : undefined;
    // JSON success response.
    return res.json(await listSettingHistory({ key, limit }));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /settings/sla-policies — list SLA rows (seeds defaults first). */
export async function listSlaPolicies(_req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Await async step.
    await ensureDefaultSlaPolicies();
    // JSON success response.
    return res.json(await fetchSlaPolicies());
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PUT /settings/sla-policies/:priority — upsert hours/active for a priority. */
export async function upsertSla(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Priority comes from the path; must be a known enum value.
    const priorityParsed = z
      .enum(["low", "normal", "high", "urgent"])
      .safeParse(req.params.priority);
    // Branch: conditional gate.
    if (!priorityParsed.success) {
      // Validation error response.
      return res.status(400).json({ error: "validation", message: "Invalid priority" });
    }
    // Zod schema for request shape.
    const schema = z.object({
      hours: z.number().int().min(1).max(168),
      isActive: z.boolean().optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body ?? {});
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Persist or load row.
    const row = await upsertSlaPolicy({
      priority: priorityParsed.data as Priority,
      hours: parsed.data.hours,
      isActive: parsed.data.isActive,
      actorEmployeeId: req.user!.employeeId,
    });
    // JSON success response.
    return res.json(row);
  } catch (err) {
    // Map known AppError to HTTP.
    if (err instanceof AppError) return next(err);
    // Forward error to Express.
    return next(err);
  }
}

/** PATCH /settings/:key — update one setting value (optional reason for history). */
export async function update(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      value: z.unknown(),
      reason: z.string().max(500).optional(),
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

    // Service validates key schema and writes history.
    const result = await updateSetting({
      key: req.params.key,
      value: parsed.data.value,
      actorEmployeeId: req.user!.employeeId,
      reason: parsed.data.reason,
    });
    // JSON success response.
    return res.json(result);
  } catch (err) {
    // Map known AppError to HTTP.
    if (err instanceof AppError) return next(err);
    // Forward error to Express.
    return next(err);
  }
}
