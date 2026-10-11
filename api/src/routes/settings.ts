import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as SettingsController from "../controllers/settings";

export const settingsRouter = Router();

settingsRouter.get(
  "/public",
  requireAuth,
  SettingsController.getPublic,
);

settingsRouter.get(
  "/",
  requireAuth,
  requireAction("settings.manage"),
  SettingsController.list,
);

settingsRouter.get(
  "/system",
  requireAuth,
  requireAction("settings.manage"),
  SettingsController.getSystem,
);

settingsRouter.get(
  "/history",
  requireAuth,
  requireAction("settings.manage"),
  SettingsController.listHistory,
);

settingsRouter.get(
  "/sla-policies",
  requireAuth,
  requireAction("settings.manage"),
  SettingsController.listSlaPolicies,
);

settingsRouter.put(
  "/sla-policies/:priority",
  requireAuth,
  requireAction("settings.manage"),
  SettingsController.upsertSla,
);

settingsRouter.patch(
  "/:key",
  requireAuth,
  requireAction("settings.manage"),
  SettingsController.update,
);
