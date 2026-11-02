/** Settings + SLA policy HTTP handlers (public subset vs settings.manage routes). */
import type { Request, Response } from "express";
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
import { Priority } from "@prisma/client";

/** Non-sensitive settings any authenticated client may read (seeds defaults first). */
export async function getPublic(_req: Request, res: Response) {
  // Ensure seed rows exist before reading the public subset.
  await ensureDefaultSettings();
  // JSON success response.
  return res.json(await getPublicSettings());
}

/** GET /settings — full settings map (settings.manage). */
export async function list(_req: Request, res: Response) {
  // JSON success response.
  return res.json(await getAllSettings());
}

/** GET /settings/system — system/ops status block. */
export async function getSystem(_req: Request, res: Response) {
  // JSON success response.
  return res.json(await getSystemStatus());
}

/** GET /settings/history — optional key filter and limit. */
export async function listHistory(req: Request, res: Response) {
  const key = typeof req.query.key === "string" ? req.query.key : undefined;
  const limit =
    typeof req.query.limit === "string"
      ? Number.parseInt(req.query.limit, 10)
      : undefined;
  // JSON success response.
  return res.json(await listSettingHistory({ key, limit }));
}

/** GET /settings/sla-policies — list SLA rows (seeds defaults first). */
export async function listSlaPolicies(_req: Request, res: Response) {
  // Await async step.
  await ensureDefaultSlaPolicies();
  // JSON success response.
  return res.json(await fetchSlaPolicies());
}

/** PUT /settings/sla-policies/:priority — upsert hours/active for a priority. */
export async function upsertSla(req: Request, res: Response) {
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
}

/** PATCH /settings/:key — update one setting value (reason + required version CAS). */
export async function update(req: Request, res: Response) {
  // HTTP clients must send expectedVersion so stale tabs cannot last-write-wins.
  // Internal service callers may still omit it.
  const schema = z.object({
    value: z.unknown(),
    reason: z.string().max(500).optional(),
    expectedVersion: z.number().int().min(0),
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

  // Service validates key schema, CAS version, and writes history.
  const result = await updateSetting({
    key: req.params.key,
    value: parsed.data.value,
    actorEmployeeId: req.user!.employeeId,
    reason: parsed.data.reason,
    expectedVersion: parsed.data.expectedVersion,
  });
  // JSON success response.
  return res.json(result);
}
