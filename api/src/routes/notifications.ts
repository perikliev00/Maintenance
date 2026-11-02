/** /notifications — list, unread count, mark-read, and dismiss for the current user. */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as NotificationsController from "../controllers/notifications";

export const notificationsRouter = Router();

// GET / — list notifications for the current employee.
notificationsRouter.get("/", requireAuth, asyncHandler(NotificationsController.list));

// GET /unread-count — badge count of unread notifications.
notificationsRouter.get(
  "/unread-count",
  requireAuth,
  asyncHandler(NotificationsController.unreadCount),
);

// POST /read-all — mark all notifications as read.
notificationsRouter.post(
  "/read-all",
  requireAuth,
  asyncHandler(NotificationsController.readAll),
);

// POST /:id/read — mark one notification as read.
notificationsRouter.post(
  "/:id/read",
  requireAuth,
  asyncHandler(NotificationsController.markRead),
);

// POST /:id/dismiss — dismiss one notification from the inbox.
notificationsRouter.post(
  "/:id/dismiss",
  requireAuth,
  asyncHandler(NotificationsController.dismiss),
);
