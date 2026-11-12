/** Access-card list/issue/revoke and employee picker for issuance. */
import type { Request, Response } from "express";
// Import dependency @prisma/client.
import { CardStatus, CardType } from "@prisma/client";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Import local module ../errors.
import { AppError } from "../errors";
// Continue named import list.
import {
  // Bring issueCard into scope from the import.
  issueCard,
  // Bring listCardEmployees into scope from the import.
  listCardEmployees,
  // Bring listCards into scope from the import.
  listCards,
  // Bring revokeCard into scope from the import.
  revokeCard,
} from "../services/cards";

// Zod field / transform.
const cardTypeSchema = z.nativeEnum(CardType);
// Zod field / transform.
const cardStatusSchema = z.nativeEnum(CardStatus);

/** GET /cards — list cards with optional employee/status/type/search filters. */
export async function list(req: Request, res: Response) {
  // Optional filters from query string.
  const employeeId =
    // Narrow the runtime type before using the value.
    typeof req.query.employeeId === "string"
      // Continue the conditional expression.
      ? req.query.employeeId
      // Continue the conditional expression.
      : undefined;
  // Bind q for use in the handler below.
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  // Bind staffOnly for use in the handler below.
  const staffOnly = req.query.staffOnly === "true";

  // Validate status enum when provided.
  let status: CardStatus | undefined;
  // Branch: conditional gate.
  if (typeof req.query.status === "string" && req.query.status) {
    // Parse and validate input.
    const parsed = cardStatusSchema.safeParse(req.query.status);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Throw error path.
      throw new AppError(400, "invalid_input", "Invalid status");
    }
    // Continue the controller logic.
    status = parsed.data;
  }

  // Validate cardType enum when provided.
  let cardType: CardType | undefined;
  // Branch: conditional gate.
  if (typeof req.query.cardType === "string" && req.query.cardType) {
    // Parse and validate input.
    const parsed = cardTypeSchema.safeParse(req.query.cardType);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Throw error path.
      throw new AppError(400, "invalid_input", "Invalid cardType");
    }
    // Continue the controller logic.
    cardType = parsed.data;
  }

  // Await async work into cards.
  const cards = await listCards({
    // Pass employeeId through.
    employeeId,
    // Pass status through.
    status,
    // Pass cardType through.
    cardType,
    // Provide q for the object/call below.
    q: q || undefined,
    // Pass staffOnly through.
    staffOnly,
  });
  // JSON success response.
  return res.json(cards);
}

/** GET /cards/employees — employee picker for card issuance (optional search). */
export async function listEmployees(req: Request, res: Response) {
  // Bind q for use in the handler below.
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  // Await async work into employees.
  const employees = await listCardEmployees(q || undefined);
  // JSON success response.
  return res.json(employees);
}

/** POST /cards — issue a card (idempotent via commandId). */
export async function create(req: Request, res: Response) {
  // Validate issue payload including validity window and idempotency key.
  const schema = z.object({
    // Provide cardType for the object/call below.
    cardType: cardTypeSchema,
    // Validate field employeeId.
    employeeId: z.string().min(1).nullable().optional(),
    // Validate field locationId.
    locationId: z.string().min(1).nullable().optional(),
    // Validate field validFrom.
    validFrom: z.string().datetime(),
    // Validate field validUntil.
    validUntil: z.string().datetime(),
    // Validate field label.
    label: z.string().max(120).nullable().optional(),
    // Validate field commandId.
    commandId: z.string().uuid(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Throw error path.
    throw new AppError(400, "invalid_input", "Invalid card payload", {
      // Provide issues for the object/call below.
      issues: parsed.error.issues,
    });
  }
  // requireAuth should have set user; guard for safety.
  if (!req.user) {
    // Throw error path.
    throw new AppError(401, "unauthorized", "Missing user");
  }

  // Capture service / command result.
  const result = await issueCard({
    // Provide cardType for the object/call below.
    cardType: parsed.data.cardType,
    // Provide employeeId for the object/call below.
    employeeId: parsed.data.employeeId,
    // Provide locationId for the object/call below.
    locationId: parsed.data.locationId,
    // Provide validFrom for the object/call below.
    validFrom: new Date(parsed.data.validFrom),
    // Provide validUntil for the object/call below.
    validUntil: new Date(parsed.data.validUntil),
    // Provide label for the object/call below.
    label: parsed.data.label,
    // Provide commandId for the object/call below.
    commandId: parsed.data.commandId,
    // Provide issuedByEmployeeId for the object/call below.
    issuedByEmployeeId: req.user.employeeId,
  });

  // 200 on idempotent replay; 201 on first create.
  return res.status(result.idempotent ? 200 : 201).json(result.card);
}

/** POST /cards/:id/revoke — revoke an issued card. */
export async function revoke(req: Request, res: Response) {
  // Await async work into card.
  const card = await revokeCard({
    // Provide cardId for the object/call below.
    cardId: req.params.id,
    // Provide actorEmployeeId for the object/call below.
    actorEmployeeId: req.user!.employeeId,
  });
  // JSON success response.
  return res.json(card);
}
