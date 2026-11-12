/** Live operations board snapshot, filtered by the caller's DataScope. */
import type { NextFunction, Request, Response } from "express";
// Continue named import list.
import {
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring sessionTaskWhere into scope from the import.
  sessionTaskWhere,
  // Bring taskWhere into scope from the import.
  taskWhere,
  // Bring ticketWhere into scope from the import.
  ticketWhere,
  // Bring locationWhere into scope from the import.
  locationWhere,
} from "../services/dataScope";
// Continue named import list.
import {
  // Bring getOperationsLive into scope from the import.
  getOperationsLive,
  // Bring getOperationsLiveAttentionPage into scope from the import.
  getOperationsLiveAttentionPage,
  // Continue the controller logic.
  type NeedsAttentionKind,
} from "../services/operationsLive";
// Import local module ../errors.
import { AppError } from "../errors";

const ATTENTION_KINDS = new Set<NeedsAttentionKind>([
  // Pass string literal argument.
  "awaiting_inspection",
  // Pass string literal argument.
  "past_due",
  // Pass string literal argument.
  "blocking_ticket",
]);

/** GET /operations/live — board snapshot for rooms/tasks/tickets in scope. */
export async function live(req: Request, res: Response) {
  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Load data from the domain service.
  const data = await getOperationsLive({
    task: taskWhere(scope),
    ticket: ticketWhere(scope),
    session: sessionTaskWhere(scope),
    location: locationWhere(scope),
  });
  // Write JSON body for a successful response.
  res.json(data);
}

/** GET /operations/live/attention — paginated needs-attention page for one kind. */
export async function liveAttention(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  const kindRaw = String(req.query.kind ?? "");
  // Guard: skip or fail when the negated condition holds.
  if (!ATTENTION_KINDS.has(kindRaw as NeedsAttentionKind)) {
    // Abort with an application/HTTP error.
    throw new AppError(
      // Continue the controller logic.
      400,
      // Pass string literal argument.
      "invalid_query",
      // Pass string literal argument.
      "kind must be awaiting_inspection, past_due, or blocking_ticket",
    );
  }
  const cursor =
    // Narrow the runtime type before using the value.
    typeof req.query.cursor === "string" && req.query.cursor.length > 0
      // Continue the conditional expression.
      ? req.query.cursor
      // Continue the conditional expression.
      : null;
  const limitRaw = req.query.limit;
  const limit =
    // Narrow the runtime type before using the value.
    typeof limitRaw === "string" && limitRaw.length > 0
      // Continue the conditional expression.
      ? Number(limitRaw)
      // Continue the conditional expression.
      : undefined;
  // Branch when this condition holds.
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    // Abort with an application/HTTP error.
    throw new AppError(400, "invalid_query", "limit must be a positive number");
  }

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Load data from the domain service.
  const data = await getOperationsLiveAttentionPage({
    kind: kindRaw as NeedsAttentionKind,
    cursor,
    limit,
    scopeWhere: {
      task: taskWhere(scope),
      ticket: ticketWhere(scope),
    },
  });
  // Write JSON body for a successful response.
  res.json(data);
}
