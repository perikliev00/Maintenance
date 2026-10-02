import { Router } from "express";
import { CardStatus, CardType } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../services/cleaning";
import {
  issueCard,
  listCardEmployees,
  listCards,
  revokeCard,
} from "../services/cards";

export const cardsRouter = Router();

const cardTypeSchema = z.nativeEnum(CardType);
const cardStatusSchema = z.nativeEnum(CardStatus);

cardsRouter.get(
  "/",
  requireAuth,
  requireAction("cards.view"),
  async (req, res, next) => {
    try {
      const employeeId =
        typeof req.query.employeeId === "string"
          ? req.query.employeeId
          : undefined;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
      const staffOnly = req.query.staffOnly === "true";

      let status: CardStatus | undefined;
      if (typeof req.query.status === "string" && req.query.status) {
        const parsed = cardStatusSchema.safeParse(req.query.status);
        if (!parsed.success) {
          throw new AppError(400, "invalid_input", "Invalid status");
        }
        status = parsed.data;
      }

      let cardType: CardType | undefined;
      if (typeof req.query.cardType === "string" && req.query.cardType) {
        const parsed = cardTypeSchema.safeParse(req.query.cardType);
        if (!parsed.success) {
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
      return res.json(cards);
    } catch (err) {
      return next(err);
    }
  },
);

cardsRouter.get(
  "/employees",
  requireAuth,
  requireAction("cards.issue"),
  async (req, res, next) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
      const employees = await listCardEmployees(q || undefined);
      return res.json(employees);
    } catch (err) {
      return next(err);
    }
  },
);

cardsRouter.post(
  "/",
  requireAuth,
  requireAction("cards.issue"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        cardType: cardTypeSchema,
        employeeId: z.string().min(1).nullable().optional(),
        locationId: z.string().min(1).nullable().optional(),
        validFrom: z.string().datetime(),
        validUntil: z.string().datetime(),
        label: z.string().max(120).nullable().optional(),
        commandId: z.string().uuid(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "invalid_input", "Invalid card payload", {
          issues: parsed.error.issues,
        });
      }
      if (!req.user) {
        throw new AppError(401, "unauthorized", "Missing user");
      }

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

      return res.status(result.idempotent ? 200 : 201).json(result.card);
    } catch (err) {
      return next(err);
    }
  },
);

cardsRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("cards.revoke"),
  async (req, res, next) => {
    try {
      const card = await revokeCard({
        cardId: req.params.id,
        actorEmployeeId: req.user!.employeeId,
      });
      return res.json(card);
    } catch (err) {
      return next(err);
    }
  },
);
