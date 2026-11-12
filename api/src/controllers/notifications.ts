/** In-app notifications for the authenticated employee's inbox only. */
import type { Request, Response } from "express";
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring dismissNotification into scope from the import.
  dismissNotification,
  // Bring listNotificationsForEmployee into scope from the import.
  listNotificationsForEmployee,
  // Bring markAllNotificationsRead into scope from the import.
  markAllNotificationsRead,
  // Bring markNotificationRead into scope from the import.
  markNotificationRead,
  // Bring unreadNotificationCount into scope from the import.
  unreadNotificationCount,
} from "../services/notifications";

/** GET /notifications — paginated inbox for the current employee. */
export async function list(req: Request, res: Response) {
  // Query flags: unread-only, include dismissed, cursor pagination, limit.
  const schema = z.object({
    unread: z
      // Restrict to an allowed enum set.
      .enum(["1", "true", "0", "false"])
      // Allow the field to be omitted.
      .optional()
      // Continue the fluent chain.
      .transform((v) => v === "1" || v === "true"),
    includeDismissed: z
      // Restrict to an allowed enum set.
      .enum(["1", "true", "0", "false"])
      // Allow the field to be omitted.
      .optional()
      // Continue the fluent chain.
      .transform((v) => v === "1" || v === "true"),
    // Validate field cursor.
    cursor: z.string().optional(),
    // Validate field limit.
    limit: z.coerce.number().int().positive().max(100).optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.query);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
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
}

/** GET /notifications/unread-count — badge count for the current employee. */
export async function unreadCount(req: Request, res: Response) {
  // JSON success response.
  return res.json(
    // Await async step.
    await unreadNotificationCount(req.user!.employeeId),
  );
}

/** POST /notifications/read-all — mark every notification read for the caller. */
export async function readAll(req: Request, res: Response) {
  // JSON success response.
  return res.json(
    // Await async step.
    await markAllNotificationsRead(req.user!.employeeId),
  );
}

/** POST /notifications/:id/read — mark one notification read (must own it). */
export async function markRead(req: Request, res: Response) {
  // JSON success response.
  return res.json(
    // Await async step.
    await markNotificationRead({
      employeeId: req.user!.employeeId,
      notificationId: req.params.id,
    }),
  );
}

/** POST /notifications/:id/dismiss — dismiss one notification (must own it). */
export async function dismiss(req: Request, res: Response) {
  // JSON success response.
  return res.json(
    // Await async step.
    await dismissNotification({
      employeeId: req.user!.employeeId,
      notificationId: req.params.id,
    }),
  );
}
