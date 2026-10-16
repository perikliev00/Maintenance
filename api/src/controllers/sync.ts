/**
 * Offline sync: push idempotent client commands (commandId UUID) and pull
 * server deltas since a cursor. Authorization of each command is inside pushSync.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pullSync, pushSync } from "../services/sync";

/** POST /sync/push — apply a batch of offline client commands (max 100). */
export async function push(req: Request, res: Response, next: NextFunction) {
  try {
    // Each command needs a UUID commandId for idempotency.
    const schema = z.object({
      deviceId: z.string().optional(),
      commands: z
        .array(
          z.object({
            commandId: z.string().uuid(),
            type: z.string().min(1),
            payload: z.record(z.unknown()).default({}),
            clientTime: z.string().optional(),
          }),
        )
        .max(100),
    });
    const parsed = schema.safeParse(req.body ?? {});
    // Reject oversized/malformed batches before applying anything.
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Service authorizes and applies each command; returns per-command results.
    const result = await pushSync({
      user: req.user!,
      commands: parsed.data.commands,
      deviceId: parsed.data.deviceId,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

/** GET /sync/pull — server deltas since an optional cursor for offline clients. */
export async function pull(req: Request, res: Response, next: NextFunction) {
  try {
    // Cursor timestamp; hotelDate/deviceId optional scoping for the pull set.
    const sinceRaw =
      typeof req.query.since === "string" ? req.query.since : undefined;
    const hotelDate =
      typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
    const deviceId =
      typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    // Invalid since must not silently become epoch or NaN.
    if (sinceRaw && Number.isNaN(since?.getTime())) {
      return res.status(400).json({ error: "validation", message: "Invalid since" });
    }
    const result = await pullSync({
      user: req.user!,
      since,
      hotelDate,
      deviceId,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}
