/** /notifications — list, unread count, mark-read, and dismiss for the current user. */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as NotificationsController from "../controllers/notifications";

// Create the Express router for in-app notification endpoints.
// Express router for the current user's notification inbox.
export const notificationsRouter = Router();

// GET / — list notifications for the current employee.
notificationsRouter.get("/", requireAuth, asyncHandler(NotificationsController.list));

// GET /unread-count — badge count of unread notifications.
notificationsRouter.get(
  "/unread-count",
  // Require an authenticated session before reading the unread badge count.
  requireAuth,
  // Delegate to the unread-count controller with async error forwarding.
  asyncHandler(NotificationsController.unreadCount),
);

// POST /read-all — mark all notifications as read.
notificationsRouter.post(
  "/read-all",
  // Require an authenticated session before bulk-marking notifications read.
  requireAuth,
  // Delegate to the read-all controller with async error forwarding.
  asyncHandler(NotificationsController.readAll),
);

// POST /:id/read — mark one notification as read.
notificationsRouter.post(
  "/:id/read",
  // Require an authenticated session before marking one notification read.
  requireAuth,
  // Delegate to the mark-read controller with async error forwarding.
  asyncHandler(NotificationsController.markRead),
);

// POST /:id/dismiss — dismiss one notification from the inbox.
notificationsRouter.post(
  "/:id/dismiss",
  // Require an authenticated session before dismissing a notification.
  requireAuth,
  // Delegate to the dismiss controller with async error forwarding.
  asyncHandler(NotificationsController.dismiss),
);
