/**
 * /settings — public subset for any authed user; manage paths need settings.manage.
 * SLA policies and history live under the same router.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as SettingsController from "../controllers/settings";

// Create the Express router for settings and SLA policy endpoints.
export const settingsRouter = Router();

// GET /public — any authenticated user; no settings.manage required.
settingsRouter.get(
  "/public",
  // Require an authenticated session before reading public settings.
  requireAuth,
  // Delegate to the public settings controller with async error forwarding.
  asyncHandler(SettingsController.getPublic),
);

// GET / — full settings list for the control panel.
settingsRouter.get(
  "/",
  // Require an authenticated session before listing full settings.
  requireAuth,
  // Authorize settings.manage for the full settings list.
  requireAction("settings.manage"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(SettingsController.list),
);

// GET /system — system/ops settings block.
settingsRouter.get(
  "/system",
  // Require an authenticated session before reading system settings.
  requireAuth,
  // Authorize settings.manage for system settings.
  requireAction("settings.manage"),
  // Delegate to the system settings controller with async error forwarding.
  asyncHandler(SettingsController.getSystem),
);

// GET /history — settings change history.
settingsRouter.get(
  "/history",
  // Require an authenticated session before reading settings history.
  requireAuth,
  // Authorize settings.manage for history reads.
  requireAction("settings.manage"),
  // Delegate to the history controller with async error forwarding.
  asyncHandler(SettingsController.listHistory),
);

// GET /sla-policies — list ticket SLA policies by priority.
settingsRouter.get(
  "/sla-policies",
  // Require an authenticated session before listing SLA policies.
  requireAuth,
  // Authorize settings.manage for SLA policy reads.
  requireAction("settings.manage"),
  // Delegate to the SLA list controller with async error forwarding.
  asyncHandler(SettingsController.listSlaPolicies),
);

// PUT /sla-policies/:priority — upsert SLA policy for a priority.
settingsRouter.put(
  "/sla-policies/:priority",
  // Require an authenticated session before upserting an SLA policy.
  requireAuth,
  // Authorize settings.manage for SLA policy writes.
  requireAction("settings.manage"),
  // Delegate to the SLA upsert controller with async error forwarding.
  asyncHandler(SettingsController.upsertSla),
);

// PATCH /:key — update a single settings key.
settingsRouter.patch(
  "/:key",
  // Require an authenticated session before updating a settings key.
  requireAuth,
  // Authorize settings.manage for key updates.
  requireAction("settings.manage"),
  // Delegate to the update controller with async error forwarding.
  asyncHandler(SettingsController.update),
);
