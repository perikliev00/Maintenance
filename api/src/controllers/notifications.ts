import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  dismissNotification,
  listNotificationsForEmployee,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../services/notifications";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
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
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }

    return res.json(
      await listNotificationsForEmployee({
        employeeId: req.user!.employeeId,
        unreadOnly: parsed.data.unread,
        includeDismissed: parsed.data.includeDismissed,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      }),
    );
  } catch (err) {
    return next(err);
  }
}

export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await unreadNotificationCount(req.user!.employeeId),
    );
  } catch (err) {
    return next(err);
  }
}

export async function readAll(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await markAllNotificationsRead(req.user!.employeeId),
    );
  } catch (err) {
    return next(err);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await markNotificationRead({
        employeeId: req.user!.employeeId,
        notificationId: req.params.id,
      }),
    );
  } catch (err) {
    return next(err);
  }
}

export async function dismiss(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await dismissNotification({
        employeeId: req.user!.employeeId,
        notificationId: req.params.id,
      }),
    );
  } catch (err) {
    return next(err);
  }
}
