/**
 * /settings — public subset for any authed user; manage paths need settings.manage.
 * SLA policies and history live under the same router.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as SettingsController from "../controllers/settings";

export const settingsRouter = Router();

// GET /public — any authenticated user; no settings.manage required.
settingsRouter.get(
  "/public",
  requireAuth,
  asyncHandler(SettingsController.getPublic),
);

// GET / — full settings list for the control panel.
settingsRouter.get(
  "/",
  requireAuth,
  requireAction("settings.manage"),
  asyncHandler(SettingsController.list),
);

// GET /system — system/ops settings block.
settingsRouter.get(
  "/system",
  requireAuth,
  requireAction("settings.manage"),
  asyncHandler(SettingsController.getSystem),
);

// GET /history — settings change history.
settingsRouter.get(
  "/history",
  requireAuth,
  requireAction("settings.manage"),
  asyncHandler(SettingsController.listHistory),
);

// GET /sla-policies — list ticket SLA policies by priority.
settingsRouter.get(
  "/sla-policies",
  requireAuth,
  requireAction("settings.manage"),
  asyncHandler(SettingsController.listSlaPolicies),
);

// PUT /sla-policies/:priority — upsert SLA policy for a priority.
settingsRouter.put(
  "/sla-policies/:priority",
  requireAuth,
  requireAction("settings.manage"),
  asyncHandler(SettingsController.upsertSla),
);

// PATCH /:key — update a single settings key.
settingsRouter.patch(
  "/:key",
  requireAuth,
  requireAction("settings.manage"),
  asyncHandler(SettingsController.update),
);
