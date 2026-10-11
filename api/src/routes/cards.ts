import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as CardsController from "../controllers/cards";

export const cardsRouter = Router();

cardsRouter.get(
  "/",
  requireAuth,
  requireAction("cards.view"),
  CardsController.list,
);

cardsRouter.get(
  "/employees",
  requireAuth,
  requireAction("cards.issue"),
  CardsController.listEmployees,
);

cardsRouter.post(
  "/",
  requireAuth,
  requireAction("cards.issue"),
  CardsController.create,
);

cardsRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("cards.revoke"),
  CardsController.revoke,
);
