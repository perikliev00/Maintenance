/**
 * Cleaning session complete/cancel and overdue review list.
 * complete/cancel require commandId (idempotency) and session scope access.
 */
import type { Request, Response } from "express";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring cancelCleaningSession into scope from the import.
  cancelCleaningSession,
  // Bring completeCleaningSession into scope from the import.
  completeCleaningSession,
  // Bring listOverdueSessions into scope from the import.
  listOverdueSessions,
} from "../../services/cleaning";
// Import local module ../../services/cleaning/authorization.
import { canBypassCleaningAssignee } from "../../services/cleaning/authorization";
// Continue named import list.
import {
  // Bring assertCanAccessSession into scope from the import.
  assertCanAccessSession,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring sessionTaskWhere into scope from the import.
  sessionTaskWhere,
} from "../../services/dataScope";

/** Complete a session; requires cleaning.complete. SEC-002 bypass is separate from that grant. */
export async function complete(req: Request, res: Response) {
  // commandId required for idempotent complete; notes/version optional.
  const schema = z.object({
    // Validate field commandId.
    commandId: z.string().uuid(),
    // Validate field notes.
    notes: z.string().optional(),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().optional(),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // DataScope must include this session before mutation.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessSession(scope, req.params.id);

  // Invoke service and capture the result payload.
  const result = await completeCleaningSession({
    // Provide sessionId for the object/call below.
    sessionId: req.params.id,
    // Provide employeeId for the object/call below.
    employeeId: req.user!.employeeId,
    // Provide commandId for the object/call below.
    commandId: parsed.data.commandId,
    // Provide notes for the object/call below.
    notes: parsed.data.notes,
    // Provide expectedVersion for the object/call below.
    expectedVersion: parsed.data.expectedVersion,
    // Same bypass set as tickets (owner/supervisor/manager/admin/reception).
    bypassSessionOwnerCheck: canBypassCleaningAssignee(req.user!.role),
  });

  // JSON success response with the payload.
  return res.json(result);
}

/** POST /sessions/:id/cancel — cancel overdue/stuck session (reviewers bypass owner). */
export async function cancel(req: Request, res: Response) {
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field commandId.
    commandId: z.string().uuid(),
    // Validate field notes.
    notes: z.string().optional(),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().optional(),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessSession(scope, req.params.id);

  // Invoke service and capture the result payload.
  const result = await cancelCleaningSession({
    // Provide sessionId for the object/call below.
    sessionId: req.params.id,
    // Provide employeeId for the object/call below.
    employeeId: req.user!.employeeId,
    // Provide commandId for the object/call below.
    commandId: parsed.data.commandId,
    // Provide notes for the object/call below.
    notes: parsed.data.notes,
    // Provide expectedVersion for the object/call below.
    expectedVersion: parsed.data.expectedVersion,
    // Reviewers cancel abandoned sessions owned by others.
    bypassSessionOwnerCheck: true,
  });

  // JSON success response with the payload.
  return res.json(result);
}

/** GET /sessions/review — overdue sessions in the caller's scope. */
export async function listReview(req: Request, res: Response) {
  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await async work into sessions.
  const sessions = await listOverdueSessions(sessionTaskWhere(scope));
  // JSON success response with the payload.
  return res.json(sessions);
}
