import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { authLoginLimiter } from "../middleware/security";
import * as authController from "../controllers/auth";

export const authRouter = Router();

authRouter.post("/login", authLoginLimiter, authController.login);

authRouter.post("/refresh", authController.refresh);

authRouter.post("/logout", asyncHandler(authController.logout));

authRouter.post(
  "/logout-all",
  requireAuth,
  asyncHandler(authController.logoutAll),
);

authRouter.get("/me", requireAuth, asyncHandler(authController.me));
