/**
 * Attendance intervals, CSV export, device ingest, and adjustment workflow.
 * Action gates live on the route; ingest is idempotent on externalEventId.
 */
import type { NextFunction, Request, Response } from "express";
import { AttendanceEventKind } from "@prisma/client";
import { z } from "zod/v3";
import { AppError } from "../errors";
import {
  getInterval as getIntervalById,
  ingestEvent as ingestAttendanceEvent,
  intervalsToCsv,
  listIntervals as fetchIntervals,
  listIntervalsForExport,
  maxClockSkewSeconds,
  requestAdjustment as createAdjustment,
  reviewAdjustment as reviewAdjustmentDecision,
} from "../services/attendance";

/** Optional list scope: month / today / week / review queue. */
const scopeSchema = z.enum(["month", "today", "week", "review"]).optional();

/** Normalize list filter query fields (scope, month, department, search, employee). */
function parseListQuery(query: Record<string, unknown>) {
  // Return value / early exit.
  return {
    scope:
      typeof query.scope === "string" &&
      ["month", "today", "week", "review"].includes(query.scope)
        ? (query.scope as "month" | "today" | "week" | "review")
        : undefined,
    month: typeof query.month === "string" ? query.month.trim() : undefined,
    department:
      typeof query.department === "string" ? query.department.trim() : undefined,
    q: typeof query.q === "string" ? query.q.trim() : undefined,
    employeeId:
      typeof query.employeeId === "string" ? query.employeeId.trim() : undefined,
  };
}

/** Normalize cursor pagination (limit + cursor). */
function parsePageQuery(query: Record<string, unknown>) {
  const limitRaw =
    typeof query.limit === "string" ? Number(query.limit) : undefined;
  // Return value / early exit.
  return {
    limit:
      limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
    cursor: typeof query.cursor === "string" ? query.cursor.trim() : undefined,
  };
}

/** GET /attendance/intervals — paginated intervals plus max clock skew. */
export async function listIntervals(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    const filter = parseListQuery(req.query as Record<string, unknown>);
    const page = parsePageQuery(req.query as Record<string, unknown>);
    // Validate scope enum when present (throws ZodError on bad values).
    scopeSchema.parse(filter.scope);
    // Fetch page and skew metric in parallel.
    const [list, maxSkew] = await Promise.all([
      fetchIntervals(filter, page),
      maxClockSkewSeconds(filter),
    ]);
    // JSON success response.
    return res.json({
      intervals: list.intervals,
      total: list.total,
      nextCursor: list.nextCursor,
      limit: list.limit,
      maxClockSkewSeconds: maxSkew,
    });
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /attendance/intervals/:id — single interval detail. */
export async function getInterval(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    const interval = await getIntervalById(req.params.id);
    // JSON success response.
    return res.json(interval);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/**
 * CSV download; oversized exports surface as 413 with details instead of a
 * truncated file when the service rejects the payload size.
 */
export async function exportCsv(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const filter = parseListQuery(req.query as Record<string, unknown>);
    // Load export rows (may throw AppError 413 if too large).
    const { intervals, truncated, total } =
      // Await async step.
      await listIntervalsForExport(filter);
    const csv = intervalsToCsv(intervals);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="attendance.csv"',
    );
    res.setHeader("X-Attendance-Total", String(total));
    // Soft truncation flag when the service capped the row set.
    if (truncated) {
      res.setHeader("X-Attendance-Truncated", "true");
    }
    // Return value / early exit.
    return res.send(csv);
  } catch (err) {
    // Explicit 413 JSON for oversized export instead of generic error handler.
    if (err instanceof AppError && err.status === 413) {
      // Return value / early exit.
      return res.status(413).json({
        error: err.code,
        message: err.message,
        details: err.details,
      });
    }
    // Forward error to Express.
    return next(err);
  }
}

/** Device clock-in/out ingest; 201 when created, 200 when replaying an existing event. */
export async function ingestEvent(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // externalEventId is the idempotency key for device punches.
    const schema = z.object({
      externalEventId: z.string().min(1),
      source: z.string().min(1).optional(),
      employeeId: z.string().min(1),
      kind: z.nativeEnum(AttendanceEventKind),
      deviceTime: z.string().min(1),
      receivedAt: z.string().optional(),
      clockSkewSeconds: z.number().int().nullable().optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Capture service / command result.
    const result = await ingestAttendanceEvent(parsed.data);
    // 201 on first insert; 200 on idempotent replay.
    return res.status(result.created ? 201 : 200).json({
      created: result.created,
      event: {
        id: result.event.id,
        externalEventId: result.event.externalEventId,
        source: result.event.source,
        employeeId: result.event.employeeId,
        kind: result.event.kind,
        deviceTime: result.event.deviceTime.toISOString(),
        receivedAt: result.event.receivedAt.toISOString(),
        normalizedTime: result.event.normalizedTime.toISOString(),
        clockSkewSeconds: result.event.clockSkewSeconds,
      },
      intervalId: result.intervalId,
    });
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /attendance/adjustments — employee requests a correction. */
export async function requestAdjustment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      intervalId: z.string().min(1),
      reason: z.string().min(1),
      proposedStartedAt: z.string().optional(),
      proposedEndedAt: z.string().optional(),
      proposedBreakMinutes: z.number().int().min(0).optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const adj = await createAdjustment({
      ...parsed.data,
      requestedById: req.user!.employeeId,
      actorRole: req.user!.role,
    });
    // Return value / early exit.
    return res.status(201).json({
      id: adj.id,
      intervalId: adj.intervalId,
      status: adj.status,
      reason: adj.reason,
    });
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /attendance/adjustments/:id/review — approve or reject an adjustment. */
export async function reviewAdjustment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().optional(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    // Service applies interval changes when approved.
    const interval = await reviewAdjustmentDecision({
      adjustmentId: req.params.id,
      reviewedById: req.user!.employeeId,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
    });
    // JSON success response.
    return res.json(interval);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
