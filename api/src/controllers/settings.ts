import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
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

export async function getPublic(_req: Request, res: Response, next: NextFunction) {
  try {
    await ensureDefaultSettings();
    return res.json(await getPublicSettings());
  } catch (err) {
    return next(err);
  }
}

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await getAllSettings());
  } catch (err) {
    return next(err);
  }
}

export async function getSystem(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await getSystemStatus());
  } catch (err) {
    return next(err);
  }
}

export async function listHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const limit =
      typeof req.query.limit === "string"
        ? Number.parseInt(req.query.limit, 10)
        : undefined;
    return res.json(await listSettingHistory({ key, limit }));
  } catch (err) {
    return next(err);
  }
}

export async function listSlaPolicies(_req: Request, res: Response, next: NextFunction) {
  try {
    await ensureDefaultSlaPolicies();
    return res.json(await fetchSlaPolicies());
  } catch (err) {
    return next(err);
  }
}

export async function upsertSla(req: Request, res: Response, next: NextFunction) {
  try {
    const priorityParsed = z
      .enum(["low", "normal", "high", "urgent"])
      .safeParse(req.params.priority);
    if (!priorityParsed.success) {
      return res.status(400).json({ error: "validation", message: "Invalid priority" });
    }
    const schema = z.object({
      hours: z.number().int().min(1).max(168),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const row = await upsertSlaPolicy({
      priority: priorityParsed.data as Priority,
      hours: parsed.data.hours,
      isActive: parsed.data.isActive,
      actorEmployeeId: req.user!.employeeId,
    });
    return res.json(row);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      value: z.unknown(),
      reason: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }

    const result = await updateSetting({
      key: req.params.key,
      value: parsed.data.value,
      actorEmployeeId: req.user!.employeeId,
      reason: parsed.data.reason,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(err);
  }
}
