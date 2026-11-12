/** In-app notifications for the authenticated employee's inbox only. */
import type { Request, Response } from "express";
// Import dependency zod/v3.
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
    // Provide unread for the object/call below.
    unread: z
      // Restrict to an allowed enum set.
      .enum(["1", "true", "0", "false"])
      // Allow the field to be omitted.
      .optional()
      // Continue the fluent chain.
      .transform((v) => v === "1" || v === "true"),
    // Provide includeDismissed for the object/call below.
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
    // Return value / early exit.
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
      // Provide employeeId for the object/call below.
      employeeId: req.user!.employeeId,
      // Provide unreadOnly for the object/call below.
      unreadOnly: parsed.data.unread,
      // Provide includeDismissed for the object/call below.
      includeDismissed: parsed.data.includeDismissed,
      // Provide cursor for the object/call below.
      cursor: parsed.data.cursor,
      // Provide limit for the object/call below.
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
      // Provide employeeId for the object/call below.
      employeeId: req.user!.employeeId,
      // Provide notificationId for the object/call below.
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
      // Provide employeeId for the object/call below.
      employeeId: req.user!.employeeId,
      // Provide notificationId for the object/call below.
      notificationId: req.params.id,
    }),
  );
}
