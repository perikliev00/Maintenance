/** In-app notifications for the authenticated employee's inbox only. */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import {
  dismissNotification,
  listNotificationsForEmployee,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../services/notifications";

/** GET /notifications — paginated inbox for the current employee. */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Query flags: unread-only, include dismissed, cursor pagination, limit.
    const schema = z.object({
      unread: z
        .enum(["1", "true", "0", "false"])
        .optional()
        .transform((v) => v === "1" || v === "true"),
      includeDismissed: z
        .enum(["1", "true", "0", "false"])
        .optional()
        .transform((v) => v === "1" || v === "true"),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.query);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }

    // Always scoped to the caller's employeeId (no cross-user reads).
    return res.json(
      // Await async step.
      await listNotificationsForEmployee({
        employeeId: req.user!.employeeId,
        unreadOnly: parsed.data.unread,
        includeDismissed: parsed.data.includeDismissed,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      }),
    );
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /notifications/unread-count — badge count for the current employee. */
export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(
      // Await async step.
      await unreadNotificationCount(req.user!.employeeId),
    );
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /notifications/read-all — mark every notification read for the caller. */
export async function readAll(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(
      // Await async step.
      await markAllNotificationsRead(req.user!.employeeId),
    );
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /notifications/:id/read — mark one notification read (must own it). */
export async function markRead(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(
      // Await async step.
      await markNotificationRead({
        employeeId: req.user!.employeeId,
        notificationId: req.params.id,
      }),
    );
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /notifications/:id/dismiss — dismiss one notification (must own it). */
export async function dismiss(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(
      // Await async step.
      await dismissNotification({
        employeeId: req.user!.employeeId,
        notificationId: req.params.id,
      }),
    );
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
