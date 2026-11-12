/**
 * Offline sync: push idempotent client commands (commandId UUID) and pull
 * server deltas since a cursor. Authorization of each command is inside pushSync.
 */
import type { Request, Response } from "express";
import { z } from "zod/v3";
// Import local module ../services/sync.
import { pullSync, pushSync } from "../services/sync";

/** POST /sync/push — apply a batch of offline client commands (max 100). */
export async function push(req: Request, res: Response) {
  // Each command needs a UUID commandId for idempotency.
  const schema = z.object({
    // Validate field deviceId.
    deviceId: z.string().optional(),
    commands: z
      // Expect an array of elements.
      .array(
        // Continue the controller logic.
        z.object({
          // Validate field commandId.
          commandId: z.string().uuid(),
          // Validate field type.
          type: z.string().min(1),
          // Validate field payload.
          payload: z.record(z.unknown()).default({}),
          // Validate field clientTime.
          clientTime: z.string().optional(),
        }),
      )
      // Enforce maximum length/value constraint.
      .max(100),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject oversized/malformed batches before applying anything.
  if (!parsed.success) {
    // Return value or early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Service authorizes and applies each command; returns per-command results.
  const result = await pushSync({
    user: req.user!,
    commands: parsed.data.commands,
    deviceId: parsed.data.deviceId,
  });
  // JSON success response with the payload.
  return res.json(result);
}

/** GET /sync/pull — server deltas since an optional cursor for offline clients. */
export async function pull(req: Request, res: Response) {
  // Cursor timestamp; hotelDate/deviceId optional scoping for the pull set.
  const sinceRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.since === "string" ? req.query.since : undefined;
  const hotelDate =
    // Narrow the runtime type before using the value.
    typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
  const deviceId =
    // Narrow the runtime type before using the value.
    typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  // Invalid since must not silently become epoch or NaN.
  if (sinceRaw && Number.isNaN(since?.getTime())) {
    // Bad-request validation error response.
    return res.status(400).json({ error: "validation", message: "Invalid since" });
  }
  // Invoke service and capture the result payload.
  const result = await pullSync({
    user: req.user!,
    since,
    hotelDate,
    deviceId,
  });
  // JSON success response with the payload.
  return res.json(result);
}
