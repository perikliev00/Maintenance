import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
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
  listSlaPolicies,
  upsertSlaPolicy,
} from "../services/maintenance";
import { AppError } from "../services/cleaning";
import { Priority } from "@prisma/client";

export const settingsRouter = Router();

settingsRouter.get(
  "/public",
  requireAuth,
  async (_req, res, next) => {
    try {
      await ensureDefaultSettings();
      return res.json(await getPublicSettings());
    } catch (err) {
      return next(err);
    }
  },
);

settingsRouter.get(
  "/",
  requireAuth,
  requireAction("settings.manage"),
  async (_req, res, next) => {
    try {
      return res.json(await getAllSettings());
    } catch (err) {
      return next(err);
    }
  },
);

settingsRouter.get(
  "/system",
  requireAuth,
  requireAction("settings.manage"),
  async (_req, res, next) => {
    try {
      return res.json(await getSystemStatus());
    } catch (err) {
      return next(err);
    }
  },
);

settingsRouter.get(
  "/history",
  requireAuth,
  requireAction("settings.manage"),
  async (req, res, next) => {
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
  },
);

settingsRouter.get(
  "/sla-policies",
  requireAuth,
  requireAction("settings.manage"),
  async (_req, res, next) => {
    try {
      await ensureDefaultSlaPolicies();
      return res.json(await listSlaPolicies());
    } catch (err) {
      return next(err);
    }
  },
);

settingsRouter.put(
  "/sla-policies/:priority",
  requireAuth,
  requireAction("settings.manage"),
  async (req, res, next) => {
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
  },
);

settingsRouter.patch(
  "/:key",
  requireAuth,
  requireAction("settings.manage"),
  async (req, res, next) => {
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
  },
);
