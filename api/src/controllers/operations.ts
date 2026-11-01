/** Live operations board snapshot, filtered by the caller's DataScope. */
import type { NextFunction, Request, Response } from "express";
import {
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
  ticketWhere,
  locationWhere,
} from "../services/dataScope";
import {
  getOperationsLive,
  getOperationsLiveAttentionPage,
  type NeedsAttentionKind,
} from "../services/operationsLive";
import { AppError } from "../errors";

const ATTENTION_KINDS = new Set<NeedsAttentionKind>([
  "awaiting_inspection",
  "past_due",
  "blocking_ticket",
]);

/** GET /operations/live — board snapshot for rooms/tasks/tickets in scope. */
export async function live(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    const data = await getOperationsLive({
      task: taskWhere(scope),
      ticket: ticketWhere(scope),
      session: sessionTaskWhere(scope),
      location: locationWhere(scope),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/** GET /operations/live/attention — paginated needs-attention page for one kind. */
export async function liveAttention(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const kindRaw = String(req.query.kind ?? "");
    if (!ATTENTION_KINDS.has(kindRaw as NeedsAttentionKind)) {
      throw new AppError(
        400,
        "invalid_query",
        "kind must be awaiting_inspection, past_due, or blocking_ticket",
      );
    }
    const cursor =
      typeof req.query.cursor === "string" && req.query.cursor.length > 0
        ? req.query.cursor
        : null;
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === "string" && limitRaw.length > 0
        ? Number(limitRaw)
        : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      throw new AppError(400, "invalid_query", "limit must be a positive number");
    }

    const scope = await resolveDataScope(req.user!);
    const data = await getOperationsLiveAttentionPage({
      kind: kindRaw as NeedsAttentionKind,
      cursor,
      limit,
      scopeWhere: {
        task: taskWhere(scope),
        ticket: ticketWhere(scope),
      },
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}
