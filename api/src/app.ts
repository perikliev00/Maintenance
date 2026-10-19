/**
 * Express application factory: security middleware, CORS, CSRF, rate limits,
 * domain routers, and a terminal AppError-aware error handler.
 *
 * Bootstrap seeds (settings, role grants, SLA) run fire-and-forget so the
 * process can accept traffic even if DB seed races or fails (logged as warn).
 */
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { commonAreasRouter } from "./routes/commonAreas";
import { cleaningRouter } from "./routes/cleaning";
import { maintenanceRouter } from "./routes/maintenance";
import { peopleRouter } from "./routes/people";
import {
  devicesRouter,
  invitationsRouter,
} from "./routes/invitations";
import { settingsRouter } from "./routes/settings";
import { permissionsRouter } from "./routes/permissions";
import { eventsRouter } from "./routes/events";
import { operationsRouter } from "./routes/operations";
import { attendanceRouter } from "./routes/attendance";
import { dailyPlanRouter } from "./routes/dailyPlan";
import { analyticsRouter } from "./routes/analytics";
import { cardsRouter } from "./routes/cards";
import { sectorsRouter } from "./routes/sectors";
import { shiftsRouter } from "./routes/shifts";
import { locationsRouter } from "./routes/locations";
import { auditRouter } from "./routes/audit";
import { myWorkRouter } from "./routes/myWork";
import { jobsRouter } from "./routes/jobs";
import { syncRouter } from "./routes/sync";
import { notificationsRouter } from "./routes/notifications";
import { AppError } from "./errors";
import { ensureDefaultSettings } from "./services/settings";
import {
  applyCatalogGrantSeed,
  ensureDefaultRoleGrants,
} from "./services/roleGrants";
import { ensureDefaultSlaPolicies } from "./services/slaPolicies";
import { GrantKind } from "@prisma/client";
import {
  configureTrustProxy,
  globalApiLimiter,
  securityHeaders,
} from "./middleware/security";
import { requireCsrf } from "./middleware/session";

/** Build and return a configured Express app (does not listen). */
export function createApp() {
  // Fresh Express instance for this process (tests may call createApp repeatedly).
  const app = express();

  // Honor X-Forwarded-For when TRUST_PROXY=1 (needed for accurate rate-limit keys).
  configureTrustProxy(app);
  // Standard security response headers (Helmet).
  app.use(securityHeaders);

  // Comma-separated WEB_ORIGIN; trailing slashes normalized for comparison.
  const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, cb) {
        // No Origin (same-origin / non-browser) is allowed; credentials need an allowlist match.
        if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
          return cb(null, true);
        }
        // Reject unknown browser origins without throwing (cors expects false).
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  // JSON body cap keeps accidental/large payloads from exhausting memory.
  app.use(express.json({ limit: "100kb" }));
  // Parse auth/CSRF cookies before requireCsrf and auth middleware.
  app.use(cookieParser());
  // Double-submit CSRF for cookie-authenticated mutating requests.
  app.use(requireCsrf);
  // Broad per-IP ceiling; /health is skipped inside the limiter.
  app.use(globalApiLimiter);

  // Best-effort defaults so first requests work before seed
  void ensureDefaultSettings().catch((err) => {
    console.warn("ensureDefaultSettings failed", err);
  });
  void ensureDefaultRoleGrants().catch((err) => {
    console.warn("ensureDefaultRoleGrants failed", err);
  });
  // One-shot catalog seed (ledger-gated; does not restore admin revokes).
  void applyCatalogGrantSeed("grants.sectors.transfer_cross.v1", [
    {
      role: "manager",
      kind: GrantKind.action,
      key: "sectors.transfer_cross",
    },
    {
      role: "admin",
      kind: GrantKind.action,
      key: "sectors.transfer_cross",
    },
  ]).catch((err) => {
    console.warn("applyCatalogGrantSeed failed", err);
  });
  void ensureDefaultSlaPolicies().catch((err) => {
    console.warn("ensureDefaultSlaPolicies failed", err);
  });

  // Liveness probe for load balancers / orchestrators (no auth).
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Domain routers — path prefixes match the SPA client API base paths.
  app.use("/auth", authRouter);
  app.use("/rooms", roomsRouter);
  app.use("/common-areas", commonAreasRouter);
  app.use("/locations", locationsRouter);
  app.use("/cleaning", cleaningRouter);
  app.use("/maintenance", maintenanceRouter);
  app.use("/people", peopleRouter);
  app.use("/invitations", invitationsRouter);
  app.use("/devices", devicesRouter);
  app.use("/settings", settingsRouter);
  app.use("/permissions", permissionsRouter);
  app.use("/analytics", analyticsRouter);
  app.use("/events", eventsRouter);
  app.use("/operations", operationsRouter);
  app.use("/attendance", attendanceRouter);
  app.use("/daily-plan", dailyPlanRouter);
  app.use("/cards", cardsRouter);
  app.use("/sectors", sectorsRouter);
  app.use("/shifts", shiftsRouter);
  app.use("/my-work", myWorkRouter);
  app.use("/audit", auditRouter);
  // Alias kept for older clients that still call /audit-events.
  app.use("/audit-events", auditRouter);
  app.use("/jobs", jobsRouter);
  app.use("/sync", syncRouter);
  app.use("/notifications", notificationsRouter);

  // Terminal error handler: AppError → status + code; everything else → 500.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      // Typed operational errors from services/controllers.
      if (err instanceof AppError) {
        return res.status(err.status).json({
          error: err.code,
          message: err.message,
          details: err.details,
        });
      }
      // Body-parser rejects malformed JSON before controllers can validate it.
      if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "validation", message: "Invalid JSON body" });
      }
      // Unexpected failures — log server-side, hide internals from the client.
      console.error(err);
      return res.status(500).json({ error: "internal", message: "Internal server error" });
    },
  );

  return app;
}
