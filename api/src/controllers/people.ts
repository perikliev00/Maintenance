/**
 * People directory, role changes, and lifecycle (block/unblock/archive/restore).
 * Domain work lives in services/people; this file is HTTP parse → service → JSON.
 */
import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod/v3";
import {
  archivePerson,
  blockPerson,
  changePersonRole,
  getPerson,
  listPeopleDirectory,
  restorePerson,
  unblockPerson,
  PERSON_STATUSES,
  type PersonStatus,
} from "../services/people";

const lifecycleBodySchema = z.object({
  expectedStatus: z.enum(PERSON_STATUSES),
  accessVersion: z.number().int().nonnegative(),
});

function lifecycleActor(req: Request) {
  return {
    userId: req.user!.userId,
    employeeId: req.user!.employeeId,
    role: req.user!.role,
  };
}

/** GET /people — employee directory with optional search/role/onboarding filters. */
export async function list(req: Request, res: Response) {
  const limitRaw =
    typeof req.query.limit === "string"
      ? Number(req.query.limit)
      : undefined;
  const result = await listPeopleDirectory({
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    role: typeof req.query.role === "string" ? req.query.role : undefined,
    includeInactive: req.query.includeInactive === "true",
    includeArchived: req.query.includeArchived === "true",
    notOnboarded: req.query.notOnboarded === "true",
    limit: limitRaw,
    cursor:
      typeof req.query.cursor === "string" && req.query.cursor.trim()
        ? req.query.cursor.trim()
        : undefined,
  });
  return res.json(result);
}

/** GET /people/:employeeId — single person detail. */
export async function getOne(req: Request, res: Response) {
  const person = await getPerson(req.params.employeeId);
  return res.json(person);
}

/** POST /people/:employeeId/block */
export async function block(req: Request, res: Response) {
  const parsed = lifecycleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation",
      details: parsed.error.flatten(),
    });
  }
  const person = await blockPerson(
    lifecycleActor(req),
    req.params.employeeId,
    parsed.data.expectedStatus as PersonStatus,
    parsed.data.accessVersion,
  );
  return res.json(person);
}

/** POST /people/:employeeId/unblock */
export async function unblock(req: Request, res: Response) {
  const parsed = lifecycleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation",
      details: parsed.error.flatten(),
    });
  }
  const person = await unblockPerson(
    lifecycleActor(req),
    req.params.employeeId,
    parsed.data.expectedStatus as PersonStatus,
    parsed.data.accessVersion,
  );
  return res.json(person);
}

/** POST /people/:employeeId/archive */
export async function archive(req: Request, res: Response) {
  const parsed = lifecycleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation",
      details: parsed.error.flatten(),
    });
  }
  const person = await archivePerson(
    lifecycleActor(req),
    req.params.employeeId,
    parsed.data.expectedStatus as PersonStatus,
    parsed.data.accessVersion,
  );
  return res.json(person);
}

/** POST /people/:employeeId/restore */
export async function restore(req: Request, res: Response) {
  const parsed = lifecycleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation",
      details: parsed.error.flatten(),
    });
  }
  const person = await restorePerson(
    lifecycleActor(req),
    req.params.employeeId,
    parsed.data.expectedStatus as PersonStatus,
    parsed.data.accessVersion,
  );
  return res.json(person);
}

/**
 * PATCH body `{ role }`. Param `:id` is the User id (not employee id).
 * Successful role changes invalidate all sessions for that user.
 */
export async function changeRole(req: Request, res: Response) {
  const schema = z.object({
    role: z.nativeEnum(Role),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation",
      details: parsed.error.flatten(),
    });
  }

  const person = await changePersonRole({
    actorRole: req.user!.role,
    userId: req.params.id,
    nextRole: parsed.data.role,
  });
  return res.json(person);
}
