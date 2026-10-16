/** /cards — access-card list/issue/revoke and employee picker for issuance. */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as CardsController from "../controllers/cards";

export const cardsRouter = Router();

// GET / — list access cards (active and revoked as filtered by controller).
cardsRouter.get(
  "/",
  requireAuth,
  requireAction("cards.view"),
  CardsController.list,
);

// GET /employees — employees eligible for card issuance (picker).
cardsRouter.get(
  "/employees",
  requireAuth,
  requireAction("cards.issue"),
  CardsController.listEmployees,
);

// POST / — issue a new access card to an employee.
cardsRouter.post(
  "/",
  requireAuth,
  requireAction("cards.issue"),
  CardsController.create,
);

// POST /:id/revoke — revoke an issued card.
cardsRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("cards.revoke"),
  CardsController.revoke,
);
