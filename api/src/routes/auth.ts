/**
 * /auth — login, refresh, logout, and current-user profile.
 * Login is rate-limited; logout-all and /me require an authenticated session.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { authLoginLimiter } from "../middleware/security";
import { requireCsrf } from "../middleware/session";
import * as authController from "../controllers/auth";

export const authRouter = Router();

// POST /login — email/password; issues access+refresh cookies (rate-limited).
authRouter.post("/login", authLoginLimiter, authController.login);

// POST /refresh — rotate access (and refresh) from refresh cookie/body.
authRouter.post("/refresh", authController.refresh);

// POST /logout — revoke current session and clear auth cookies.
authRouter.post("/logout", asyncHandler(authController.logout));

// POST /logout-all — revoke all sessions for the authenticated user.
authRouter.post(
  "/logout-all",
  requireCsrf,
  asyncHandler(authController.logoutAll),
);

// GET /me — current user profile, grants, and landing panel.
authRouter.get("/me", requireAuth, asyncHandler(authController.me));
