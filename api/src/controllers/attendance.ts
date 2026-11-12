/**
 * Attendance intervals, CSV export, device ingest, and adjustment workflow.
 * Action gates live on the route; ingest is idempotent on externalEventId.
 */
import type { Request, Response } from "express";
import { AttendanceEventKind } from "@prisma/client";
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring getInterval into scope from the import.
  getInterval as getIntervalById,
  // Bring ingestEvent into scope from the import.
  ingestEvent as ingestAttendanceEvent,
  // Bring intervalsToCsv into scope from the import.
  intervalsToCsv,
  // Bring listIntervals into scope from the import.
  listIntervals as fetchIntervals,
  // Bring listIntervalsForExport into scope from the import.
  listIntervalsForExport,
  // Bring maxClockSkewSeconds into scope from the import.
  maxClockSkewSeconds,
  // Bring requestAdjustment into scope from the import.
  requestAdjustment as createAdjustment,
  // Bring reviewAdjustment into scope from the import.
  reviewAdjustment as reviewAdjustmentDecision,
} from "../services/attendance";

/** Optional list scope: month / today / week / review queue. */
const scopeSchema = z.enum(["month", "today", "week", "review"]).optional();

/** Normalize list filter query fields (scope, month, department, search, employee). */
function parseListQuery(query: Record<string, unknown>) {
  return {
    scope:
      // Narrow the runtime type before using the value.
      typeof query.scope === "string" &&
      // Continue the controller logic.
      ["month", "today", "week", "review"].includes(query.scope)
        // Continue the conditional expression.
        ? (query.scope as "month" | "today" | "week" | "review")
        // Continue the conditional expression.
        : undefined,
    month: typeof query.month === "string" ? query.month.trim() : undefined,
    department:
      // Narrow the runtime type before using the value.
      typeof query.department === "string" ? query.department.trim() : undefined,
    q: typeof query.q === "string" ? query.q.trim() : undefined,
    employeeId:
      // Narrow the runtime type before using the value.
      typeof query.employeeId === "string" ? query.employeeId.trim() : undefined,
  };
}

/** Normalize cursor pagination (limit + cursor). */
function parsePageQuery(query: Record<string, unknown>) {
  const limitRaw =
    // Narrow the runtime type before using the value.
    typeof query.limit === "string" ? Number(query.limit) : undefined;
  return {
    limit:
      // Continue the controller logic.
      limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
    cursor: typeof query.cursor === "string" ? query.cursor.trim() : undefined,
  };
}

/** GET /attendance/intervals — paginated intervals plus max clock skew. */
export async function listIntervals(req: Request, res: Response) {
  const filter = parseListQuery(req.query as Record<string, unknown>);
  const page = parsePageQuery(req.query as Record<string, unknown>);
  // Validate scope enum when present (throws ZodError on bad values).
  scopeSchema.parse(filter.scope);
  // Fetch page and skew metric in parallel.
  const [list, maxSkew] = await Promise.all([
    // Continue the controller logic.
    fetchIntervals(filter, page),
    // Continue the controller logic.
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
}

/** GET /attendance/intervals/:id — single interval detail. */
export async function getInterval(req: Request, res: Response) {
  const interval = await getIntervalById(req.params.id);
  // JSON success response.
  return res.json(interval);
}

/**
 * CSV download; oversized exports surface as 413 with details instead of a
 * truncated file when the service rejects the payload size (via AppError +
 * global error handler).
 */
export async function exportCsv(req: Request, res: Response) {
  const filter = parseListQuery(req.query as Record<string, unknown>);
  // Load export rows (may throw AppError 413 if too large).
  const { intervals, truncated, total } =
    // Await side-effecting async work.
    await listIntervalsForExport(filter);
  const csv = intervalsToCsv(intervals);
  // Continue the controller logic.
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  // Continue the controller logic.
  res.setHeader(
    // Pass string literal argument.
    "Content-Disposition",
    // Pass string literal argument.
    'attachment; filename="attendance.csv"',
  );
  // Continue the controller logic.
  res.setHeader("X-Attendance-Total", String(total));
  // Soft truncation flag when the service capped the row set.
  if (truncated) {
    // Continue the controller logic.
    res.setHeader("X-Attendance-Truncated", "true");
  }
  // Send the HTTP response and end the handler.
  return res.send(csv);
}

/** Device clock-in/out ingest; 201 when created, 200 when replaying an existing event. */
export async function ingestEvent(req: Request, res: Response) {
  // externalEventId is the idempotency key for device punches.
  const schema = z.object({
    // Validate field externalEventId.
    externalEventId: z.string().min(1),
    // Validate field source.
    source: z.string().min(1).optional(),
    // Validate field employeeId.
    employeeId: z.string().min(1),
    // Validate field kind.
    kind: z.nativeEnum(AttendanceEventKind),
    // Validate field deviceTime.
    deviceTime: z.string().min(1),
    // Validate field receivedAt.
    receivedAt: z.string().optional(),
    // Validate field clockSkewSeconds.
    clockSkewSeconds: z.number().int().nullable().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
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
}

/** POST /attendance/adjustments — employee requests a correction. */
export async function requestAdjustment(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field intervalId.
    intervalId: z.string().min(1),
    // Validate field reason.
    reason: z.string().min(1),
    // Validate field proposedStartedAt.
    proposedStartedAt: z.string().optional(),
    // Validate field proposedEndedAt.
    proposedEndedAt: z.string().optional(),
    // Validate field proposedBreakMinutes.
    proposedBreakMinutes: z.number().int().min(0).optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  const adj = await createAdjustment({
    // Continue the controller logic.
    ...parsed.data,
    requestedById: req.user!.employeeId,
    actorRole: req.user!.role,
  });
  return res.status(201).json({
    id: adj.id,
    intervalId: adj.intervalId,
    status: adj.status,
    reason: adj.reason,
  });
}

/** POST /attendance/adjustments/:id/review — approve or reject an adjustment. */
export async function reviewAdjustment(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field decision.
    decision: z.enum(["approved", "rejected"]),
    // Validate field reason.
    reason: z.string().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
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
}
