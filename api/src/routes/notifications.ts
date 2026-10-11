import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as NotificationsController from "../controllers/notifications";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, NotificationsController.list);

notificationsRouter.get(
  "/unread-count",
  requireAuth,
  NotificationsController.unreadCount,
);

notificationsRouter.post(
  "/read-all",
  requireAuth,
  NotificationsController.readAll,
);

notificationsRouter.post(
  "/:id/read",
  requireAuth,
  NotificationsController.markRead,
);

notificationsRouter.post(
  "/:id/dismiss",
  requireAuth,
  NotificationsController.dismiss,
);
