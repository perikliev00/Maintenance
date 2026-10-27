/** Access-card list/issue/revoke and employee picker for issuance. */
import type { NextFunction, Request, Response } from "express";
import { CardStatus, CardType } from "@prisma/client";
import { z } from "zod/v3";
import { AppError } from "../errors";
import {
  issueCard,
  listCardEmployees,
  listCards,
  revokeCard,
} from "../services/cards";

// Zod field / transform.
const cardTypeSchema = z.nativeEnum(CardType);
// Zod field / transform.
const cardStatusSchema = z.nativeEnum(CardStatus);

/** GET /cards — list cards with optional employee/status/type/search filters. */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Optional filters from query string.
    const employeeId =
      typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
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
      cardType = parsed.data;
    }

    const cards = await listCards({
      employeeId,
      status,
      cardType,
      q: q || undefined,
      staffOnly,
    });
    // JSON success response.
    return res.json(cards);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /cards/employees — employee picker for card issuance (optional search). */
export async function listEmployees(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const employees = await listCardEmployees(q || undefined);
    // JSON success response.
    return res.json(employees);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /cards — issue a card (idempotent via commandId). */
export async function create(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Validate issue payload including validity window and idempotency key.
    const schema = z.object({
      cardType: cardTypeSchema,
      employeeId: z.string().min(1).nullable().optional(),
      locationId: z.string().min(1).nullable().optional(),
      validFrom: z.string().datetime(),
      validUntil: z.string().datetime(),
      label: z.string().max(120).nullable().optional(),
      commandId: z.string().uuid(),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Throw error path.
      throw new AppError(400, "invalid_input", "Invalid card payload", {
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
      cardType: parsed.data.cardType,
      employeeId: parsed.data.employeeId,
      locationId: parsed.data.locationId,
      validFrom: new Date(parsed.data.validFrom),
      validUntil: new Date(parsed.data.validUntil),
      label: parsed.data.label,
      commandId: parsed.data.commandId,
      issuedByEmployeeId: req.user.employeeId,
    });

    // 200 on idempotent replay; 201 on first create.
    return res.status(result.idempotent ? 200 : 201).json(result.card);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /cards/:id/revoke — revoke an issued card. */
export async function revoke(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const card = await revokeCard({
      cardId: req.params.id,
      actorEmployeeId: req.user!.employeeId,
    });
    // JSON success response.
    return res.json(card);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
