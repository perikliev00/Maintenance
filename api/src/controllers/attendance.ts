/**
 * Attendance intervals, CSV export, device ingest, and adjustment workflow.
 * Action gates live on the route; ingest is idempotent on externalEventId.
 */
import type { Request, Response } from "express";
// Import dependency @prisma/client.
import { AttendanceEventKind } from "@prisma/client";
// Import dependency zod/v3.
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
  // Return value / early exit.
  return {
    // Provide scope for the object/call below.
    scope:
      // Narrow the runtime type before using the value.
      typeof query.scope === "string" &&
      // Continue the controller logic.
      ["month", "today", "week", "review"].includes(query.scope)
        // Continue the conditional expression.
        ? (query.scope as "month" | "today" | "week" | "review")
        // Continue the conditional expression.
        : undefined,
    // Provide month for the object/call below.
    month: typeof query.month === "string" ? query.month.trim() : undefined,
    // Provide department for the object/call below.
    department:
      // Narrow the runtime type before using the value.
      typeof query.department === "string" ? query.department.trim() : undefined,
    // Provide q for the object/call below.
    q: typeof query.q === "string" ? query.q.trim() : undefined,
    // Provide employeeId for the object/call below.
    employeeId:
      // Narrow the runtime type before using the value.
      typeof query.employeeId === "string" ? query.employeeId.trim() : undefined,
  };
}

/** Normalize cursor pagination (limit + cursor). */
function parsePageQuery(query: Record<string, unknown>) {
  // Bind limitRaw for use in the handler below.
  const limitRaw =
    // Narrow the runtime type before using the value.
    typeof query.limit === "string" ? Number(query.limit) : undefined;
  // Return value / early exit.
  return {
    // Provide limit for the object/call below.
    limit:
      // Continue the controller logic.
      limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
    // Provide cursor for the object/call below.
    cursor: typeof query.cursor === "string" ? query.cursor.trim() : undefined,
  };
}

/** GET /attendance/intervals — paginated intervals plus max clock skew. */
export async function listIntervals(req: Request, res: Response) {
  // Bind filter for use in the handler below.
  const filter = parseListQuery(req.query as Record<string, unknown>);
  // Bind page for use in the handler below.
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
    // Provide intervals for the object/call below.
    intervals: list.intervals,
    // Provide total for the object/call below.
    total: list.total,
    // Provide nextCursor for the object/call below.
    nextCursor: list.nextCursor,
    // Provide limit for the object/call below.
    limit: list.limit,
    // Provide maxClockSkewSeconds for the object/call below.
    maxClockSkewSeconds: maxSkew,
  });
}

/** GET /attendance/intervals/:id — single interval detail. */
export async function getInterval(req: Request, res: Response) {
  // Await async work into interval.
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
  // Bind filter for use in the handler below.
  const filter = parseListQuery(req.query as Record<string, unknown>);
  // Load export rows (may throw AppError 413 if too large).
  const { intervals, truncated, total } =
    // Await side-effecting async work.
    await listIntervalsForExport(filter);
  // Bind csv for use in the handler below.
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
    // Return value / early exit.
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
    // Provide created for the object/call below.
    created: result.created,
    // Provide event for the object/call below.
    event: {
      // Provide id for the object/call below.
      id: result.event.id,
      // Provide externalEventId for the object/call below.
      externalEventId: result.event.externalEventId,
      // Provide source for the object/call below.
      source: result.event.source,
      // Provide employeeId for the object/call below.
      employeeId: result.event.employeeId,
      // Provide kind for the object/call below.
      kind: result.event.kind,
      // Provide deviceTime for the object/call below.
      deviceTime: result.event.deviceTime.toISOString(),
      // Provide receivedAt for the object/call below.
      receivedAt: result.event.receivedAt.toISOString(),
      // Provide normalizedTime for the object/call below.
      normalizedTime: result.event.normalizedTime.toISOString(),
      // Provide clockSkewSeconds for the object/call below.
      clockSkewSeconds: result.event.clockSkewSeconds,
    },
    // Provide intervalId for the object/call below.
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
    // Return value / early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Await async work into adj.
  const adj = await createAdjustment({
    // Continue the controller logic.
    ...parsed.data,
    // Provide requestedById for the object/call below.
    requestedById: req.user!.employeeId,
    // Provide actorRole for the object/call below.
    actorRole: req.user!.role,
  });
  // Return value / early exit.
  return res.status(201).json({
    // Provide id for the object/call below.
    id: adj.id,
    // Provide intervalId for the object/call below.
    intervalId: adj.intervalId,
    // Provide status for the object/call below.
    status: adj.status,
    // Provide reason for the object/call below.
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
    // Return value / early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Service applies interval changes when approved.
  const interval = await reviewAdjustmentDecision({
    // Provide adjustmentId for the object/call below.
    adjustmentId: req.params.id,
    // Provide reviewedById for the object/call below.
    reviewedById: req.user!.employeeId,
    // Provide decision for the object/call below.
    decision: parsed.data.decision,
    // Provide reason for the object/call below.
    reason: parsed.data.reason,
  });
  // JSON success response.
  return res.json(interval);
}
