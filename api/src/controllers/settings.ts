/** Settings + SLA policy HTTP handlers (public subset vs settings.manage routes). */
import type { Request, Response } from "express";
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring ensureDefaultSettings into scope from the import.
  ensureDefaultSettings,
  // Bring getAllSettings into scope from the import.
  getAllSettings,
  // Bring getPublicSettings into scope from the import.
  getPublicSettings,
  // Bring getSystemStatus into scope from the import.
  getSystemStatus,
  // Bring listSettingHistory into scope from the import.
  listSettingHistory,
  // Bring updateSetting into scope from the import.
  updateSetting,
} from "../services/settings";
// Continue named import list.
import {
  // Bring ensureDefaultSlaPolicies into scope from the import.
  ensureDefaultSlaPolicies,
  // Bring listSlaPolicies into scope from the import.
  listSlaPolicies as fetchSlaPolicies,
  // Bring upsertSlaPolicy into scope from the import.
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
    // Narrow the runtime type before using the value.
    typeof req.query.limit === "string"
      // Continue the conditional expression.
      ? Number.parseInt(req.query.limit, 10)
      // Continue the conditional expression.
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
    // Restrict to an allowed enum set.
    .enum(["low", "normal", "high", "urgent"])
    // Run safeParse so validation failures stay typed.
    .safeParse(req.params.priority);
  if (!priorityParsed.success) {
    // Validation error response.
    return res.status(400).json({ error: "validation", message: "Invalid priority" });
  }
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field hours.
    hours: z.number().int().min(1).max(168),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
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
    // Validate field value.
    value: z.unknown(),
    // Validate field reason.
    reason: z.string().max(500).optional(),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().min(0),
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
