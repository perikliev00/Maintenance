/**
 * People directory, role changes, and lifecycle (block/unblock/archive/restore).
 * Domain work lives in services/people; this file is HTTP parse → service → JSON.
 */
import type { Request, Response } from "express";
// Import dependency @prisma/client.
import { Role } from "@prisma/client";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring archivePerson into scope from the import.
  archivePerson,
  // Bring blockPerson into scope from the import.
  blockPerson,
  // Bring changePersonRole into scope from the import.
  changePersonRole,
  // Bring getPerson into scope from the import.
  getPerson,
  // Bring listPeopleDirectory into scope from the import.
  listPeopleDirectory,
  // Bring restorePerson into scope from the import.
  restorePerson,
  // Bring unblockPerson into scope from the import.
  unblockPerson,
  // Bring PERSON_STATUSES into scope from the import.
  PERSON_STATUSES,
  // Continue the controller logic.
  type PersonStatus,
} from "../services/people";

// Zod schema lifecycleBodySchema for request validation.
const lifecycleBodySchema = z.object({
  // Validate field expectedStatus.
  expectedStatus: z.enum(PERSON_STATUSES),
  // Validate field accessVersion.
  accessVersion: z.number().int().nonnegative(),
});

// Local helper lifecycleActor shared by handlers in this file.
function lifecycleActor(req: Request) {
  // Return value or early exit.
  return {
    // Provide userId for the object/call below.
    userId: req.user!.userId,
    // Provide employeeId for the object/call below.
    employeeId: req.user!.employeeId,
    // Provide role for the object/call below.
    role: req.user!.role,
  };
}

/** GET /people — employee directory with optional search/role/onboarding filters. */
export async function list(req: Request, res: Response) {
  // Bind limitRaw for use in the handler below.
  const limitRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.limit === "string"
      // Continue the conditional expression.
      ? Number(req.query.limit)
      // Continue the conditional expression.
      : undefined;
  // Invoke service and capture the result payload.
  const result = await listPeopleDirectory({
    // Provide q for the object/call below.
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    // Provide role for the object/call below.
    role: typeof req.query.role === "string" ? req.query.role : undefined,
    // Provide includeInactive for the object/call below.
    includeInactive: req.query.includeInactive === "true",
    // Provide includeArchived for the object/call below.
    includeArchived: req.query.includeArchived === "true",
    // Provide notOnboarded for the object/call below.
    notOnboarded: req.query.notOnboarded === "true",
    // Provide limit for the object/call below.
    limit: limitRaw,
    // Provide cursor for the object/call below.
    cursor:
      // Narrow the runtime type before using the value.
      typeof req.query.cursor === "string" && req.query.cursor.trim()
        // Continue the conditional expression.
        ? req.query.cursor.trim()
        // Continue the conditional expression.
        : undefined,
  });
  // JSON success response with the payload.
  return res.json(result);
}

/** GET /people/:employeeId — single person detail. */
export async function getOne(req: Request, res: Response) {
  // Await async work into person.
  const person = await getPerson(req.params.employeeId);
  // JSON success response with the payload.
  return res.json(person);
}

/** POST /people/:employeeId/block */
export async function block(req: Request, res: Response) {
  // Parse and validate input against the schema.
  const parsed = lifecycleBodySchema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Await async work into person.
  const person = await blockPerson(
    // Continue the controller logic.
    lifecycleActor(req),
    // Pass req.params.employeeId through.
    req.params.employeeId,
    // Continue the controller logic.
    parsed.data.expectedStatus as PersonStatus,
    // Pass parsed.data.accessVersion through.
    parsed.data.accessVersion,
  );
  // JSON success response with the payload.
  return res.json(person);
}

/** POST /people/:employeeId/unblock */
export async function unblock(req: Request, res: Response) {
  // Parse and validate input against the schema.
  const parsed = lifecycleBodySchema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Await async work into person.
  const person = await unblockPerson(
    // Continue the controller logic.
    lifecycleActor(req),
    // Pass req.params.employeeId through.
    req.params.employeeId,
    // Continue the controller logic.
    parsed.data.expectedStatus as PersonStatus,
    // Pass parsed.data.accessVersion through.
    parsed.data.accessVersion,
  );
  // JSON success response with the payload.
  return res.json(person);
}

/** POST /people/:employeeId/archive */
export async function archive(req: Request, res: Response) {
  // Parse and validate input against the schema.
  const parsed = lifecycleBodySchema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Await async work into person.
  const person = await archivePerson(
    // Continue the controller logic.
    lifecycleActor(req),
    // Pass req.params.employeeId through.
    req.params.employeeId,
    // Continue the controller logic.
    parsed.data.expectedStatus as PersonStatus,
    // Pass parsed.data.accessVersion through.
    parsed.data.accessVersion,
  );
  // JSON success response with the payload.
  return res.json(person);
}

/** POST /people/:employeeId/restore */
export async function restore(req: Request, res: Response) {
  // Parse and validate input against the schema.
  const parsed = lifecycleBodySchema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Await async work into person.
  const person = await restorePerson(
    // Continue the controller logic.
    lifecycleActor(req),
    // Pass req.params.employeeId through.
    req.params.employeeId,
    // Continue the controller logic.
    parsed.data.expectedStatus as PersonStatus,
    // Pass parsed.data.accessVersion through.
    parsed.data.accessVersion,
  );
  // JSON success response with the payload.
  return res.json(person);
}

/**
 * PATCH body `{ role }`. Param `:id` is the User id (not employee id).
 * Successful role changes invalidate all sessions for that user.
 */
export async function changeRole(req: Request, res: Response) {
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field role.
    role: z.nativeEnum(Role),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }

  // Await async work into person.
  const person = await changePersonRole({
    // Provide actorRole for the object/call below.
    actorRole: req.user!.role,
    // Provide userId for the object/call below.
    userId: req.params.id,
    // Provide nextRole for the object/call below.
    nextRole: parsed.data.role,
  });
  // JSON success response with the payload.
  return res.json(person);
}
