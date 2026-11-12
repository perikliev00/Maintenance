/** /cards — access-card list/issue/revoke and employee picker for issuance. */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as CardsController from "../controllers/cards";

// Create the Express router for access-card endpoints.
// Express router for access-card list/issue/revoke flows.
export const cardsRouter = Router();

// GET / — list access cards (active and revoked as filtered by controller).
cardsRouter.get(
  "/",
  // Require an authenticated session before listing cards.
  requireAuth,
  // Authorize the cards.view action for this read.
  requireAction("cards.view"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(CardsController.list),
);

// GET /employees — employees eligible for card issuance (picker).
cardsRouter.get(
  "/employees",
  // Require an authenticated session before listing eligible employees.
  requireAuth,
  // Issuance permission gates the employee picker as well.
  requireAction("cards.issue"),
  // Delegate to the employee picker controller with async error forwarding.
  asyncHandler(CardsController.listEmployees),
);

// POST / — issue a new access card to an employee.
cardsRouter.post(
  "/",
  // Require an authenticated session before issuing a card.
  requireAuth,
  // Authorize the cards.issue action for this mutation.
  requireAction("cards.issue"),
  // Delegate to the create controller with async error forwarding.
  asyncHandler(CardsController.create),
);

// POST /:id/revoke — revoke an issued card.
cardsRouter.post(
  "/:id/revoke",
  // Require an authenticated session before revoking a card.
  requireAuth,
  // Authorize the cards.revoke action for this mutation.
  requireAction("cards.revoke"),
  // Delegate to the revoke controller with async error forwarding.
  asyncHandler(CardsController.revoke),
);
