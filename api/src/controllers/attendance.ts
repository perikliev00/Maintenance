import type { NextFunction, Request, Response } from "express";
import { AttendanceEventKind } from "@prisma/client";
import { z } from "zod";
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

const scopeSchema = z.enum(["month", "today", "week", "review"]).optional();

function parseListQuery(query: Record<string, unknown>) {
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

function parsePageQuery(query: Record<string, unknown>) {
  const limitRaw =
    typeof query.limit === "string" ? Number(query.limit) : undefined;
  return {
    limit:
      limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
    cursor: typeof query.cursor === "string" ? query.cursor.trim() : undefined,
  };
}

export async function listIntervals(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const filter = parseListQuery(req.query as Record<string, unknown>);
    const page = parsePageQuery(req.query as Record<string, unknown>);
    scopeSchema.parse(filter.scope);
    const [list, maxSkew] = await Promise.all([
      fetchIntervals(filter, page),
      maxClockSkewSeconds(filter),
    ]);
    return res.json({
      intervals: list.intervals,
      total: list.total,
      nextCursor: list.nextCursor,
      limit: list.limit,
      maxClockSkewSeconds: maxSkew,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getInterval(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const interval = await getIntervalById(req.params.id);
    return res.json(interval);
  } catch (err) {
    return next(err);
  }
}

export async function exportCsv(req: Request, res: Response, next: NextFunction) {
  try {
    const filter = parseListQuery(req.query as Record<string, unknown>);
    const { intervals, truncated, total } =
      await listIntervalsForExport(filter);
    const csv = intervalsToCsv(intervals);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="attendance.csv"',
    );
    res.setHeader("X-Attendance-Total", String(total));
    if (truncated) {
      res.setHeader("X-Attendance-Truncated", "true");
    }
    return res.send(csv);
  } catch (err) {
    if (err instanceof AppError && err.status === 413) {
      return res.status(413).json({
        error: err.code,
        message: err.message,
        details: err.details,
      });
    }
    return next(err);
  }
}

export async function ingestEvent(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({
      externalEventId: z.string().min(1),
      source: z.string().min(1).optional(),
      employeeId: z.string().min(1),
      kind: z.nativeEnum(AttendanceEventKind),
      deviceTime: z.string().min(1),
      receivedAt: z.string().optional(),
      clockSkewSeconds: z.number().int().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const result = await ingestAttendanceEvent(parsed.data);
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
    return next(err);
  }
}

export async function requestAdjustment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({
      intervalId: z.string().min(1),
      reason: z.string().min(1),
      proposedStartedAt: z.string().optional(),
      proposedEndedAt: z.string().optional(),
      proposedBreakMinutes: z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const adj = await createAdjustment({
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
  } catch (err) {
    return next(err);
  }
}

export async function reviewAdjustment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const interval = await reviewAdjustmentDecision({
      adjustmentId: req.params.id,
      reviewedById: req.user!.employeeId,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
    });
    return res.json(interval);
  } catch (err) {
    return next(err);
  }
}
