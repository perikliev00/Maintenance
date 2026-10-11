import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { isOwner } from "../../permissions";
import {
  cancelCleaningSession,
  completeCleaningSession,
  listOverdueSessions,
} from "../../services/cleaning";
import {
  assertCanAccessSession,
  resolveDataScope,
  sessionTaskWhere,
} from "../../services/dataScope";

export async function complete(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      commandId: z.string().uuid(),
      notes: z.string().optional(),
      expectedVersion: z.number().int().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    const scope = await resolveDataScope(req.user!);
    await assertCanAccessSession(scope, req.params.id);

    const result = await completeCleaningSession({
      sessionId: req.params.id,
      employeeId: req.user!.employeeId,
      commandId: parsed.data.commandId,
      notes: parsed.data.notes,
      expectedVersion: parsed.data.expectedVersion,
      bypassSessionOwnerCheck: isOwner(req.user!.role),
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      commandId: z.string().uuid(),
      notes: z.string().optional(),
      expectedVersion: z.number().int().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    const scope = await resolveDataScope(req.user!);
    await assertCanAccessSession(scope, req.params.id);

    const result = await cancelCleaningSession({
      sessionId: req.params.id,
      employeeId: req.user!.employeeId,
      commandId: parsed.data.commandId,
      notes: parsed.data.notes,
      expectedVersion: parsed.data.expectedVersion,
      // Reviewers cancel abandoned sessions owned by others.
      bypassSessionOwnerCheck: true,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function listReview(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    const sessions = await listOverdueSessions(sessionTaskWhere(scope));
    return res.json(sessions);
  } catch (err) {
    return next(err);
  }
}
