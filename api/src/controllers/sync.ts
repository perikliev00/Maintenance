import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pullSync, pushSync } from "../services/sync";

export async function push(req: Request, res: Response, next: NextFunction) {
  try {
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
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
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

export async function pull(req: Request, res: Response, next: NextFunction) {
  try {
    const sinceRaw =
      typeof req.query.since === "string" ? req.query.since : undefined;
    const hotelDate =
      typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
    const deviceId =
      typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
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
