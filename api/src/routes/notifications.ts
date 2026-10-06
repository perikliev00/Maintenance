import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  dismissNotification,
  listNotificationsForEmployee,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../services/notifications";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req, res, next) => {
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
});

notificationsRouter.get(
  "/unread-count",
  requireAuth,
  async (req, res, next) => {
    try {
      return res.json(
        await unreadNotificationCount(req.user!.employeeId),
      );
    } catch (err) {
      return next(err);
    }
  },
);

notificationsRouter.post(
  "/read-all",
  requireAuth,
  async (req, res, next) => {
    try {
      return res.json(
        await markAllNotificationsRead(req.user!.employeeId),
      );
    } catch (err) {
      return next(err);
    }
  },
);

notificationsRouter.post(
  "/:id/read",
  requireAuth,
  async (req, res, next) => {
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
  },
);

notificationsRouter.post(
  "/:id/dismiss",
  requireAuth,
  async (req, res, next) => {
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
  },
);
