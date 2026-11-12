/**
 * Express application factory: security middleware, CORS, CSRF, rate limits,
 * domain routers, and a terminal AppError-aware error handler.
 *
 * Required DB defaults live in `startup/requiredDefaults.ts`. Production
 * `index.ts` listens first, then awaits them and calls `setBootstrapComplete(true)`.
 * Until that flag is set, `/health/ready` returns 503; bootstrap failure is fatal.
 */
// HTTP framework used to assemble middleware and routers.
import express from "express";
// Cross-origin allowlist for the SPA (credentials + Origin checks).
import cors from "cors";
// Parse Cookie header into req.cookies for session/CSRF.
import cookieParser from "cookie-parser";
// Login/refresh/logout and session routes.
import { authRouter } from "./routes/auth";
// Room inventory and occupancy routes.
import { roomsRouter } from "./routes/rooms";
// Shared/common-area location routes.
import { commonAreasRouter } from "./routes/commonAreas";
// Cleaning task assignment and completion routes.
import { cleaningRouter } from "./routes/cleaning";
// Maintenance ticket routes.
import { maintenanceRouter } from "./routes/maintenance";
// Employee/people directory and role routes.
import { peopleRouter } from "./routes/people";
// Invitation redeem + device pairing routes (same module).
import {
  devicesRouter,
  invitationsRouter,
} from "./routes/invitations";
// Hotel settings CRUD routes.
import { settingsRouter } from "./routes/settings";
// Role-grant matrix management routes.
import { permissionsRouter } from "./routes/permissions";
// Live SSE stream and ticket issuance routes.
import { eventsRouter } from "./routes/events";
// Live operations board routes.
import { operationsRouter } from "./routes/operations";
// Attendance ingest and adjustment routes.
import { attendanceRouter } from "./routes/attendance";
// Daily plan planning routes.
import { dailyPlanRouter } from "./routes/dailyPlan";
// Analytics aggregate routes.
import { analyticsRouter } from "./routes/analytics";
// Access card issue/revoke routes.
import { cardsRouter } from "./routes/cards";
// Sector configuration routes.
import { sectorsRouter } from "./routes/sectors";
// Shift schedule routes.
import { shiftsRouter } from "./routes/shifts";
// Generic location lookup routes.
import { locationsRouter } from "./routes/locations";
// Audit event query routes.
import { auditRouter } from "./routes/audit";
// My-work personal queue routes.
import { myWorkRouter } from "./routes/myWork";
// Background job status/run routes.
import { jobsRouter } from "./routes/jobs";
// Offline sync pull/push routes.
import { syncRouter } from "./routes/sync";
// In-app notification routes.
import { notificationsRouter } from "./routes/notifications";
// Typed operational errors mapped to HTTP by the terminal handler.
import { AppError } from "./errors";
// Trust-proxy, Helmet headers, and global rate limiter.
import {
  configureTrustProxy,
  globalApiLimiter,
  securityHeaders,
} from "./middleware/security";
// Double-submit CSRF middleware for cookie-authenticated mutations.
import { requireCsrf } from "./middleware/session";
// Prisma singleton used by the default readiness DB probe.
import { prisma } from "./db";
// Request metrics/logging helpers and Prometheus text renderer.
import { log, renderMetrics, requestObservability, safeErrorMessage } from "./observability";

// False until required DB defaults finish; gates /health/ready.
let bootstrapComplete = false;
// True after SIGTERM/SIGINT path starts; drains traffic with 503.
let shuttingDown = false;
// Called from index.ts after initializeRequiredDefaults succeeds.
export function setBootstrapComplete(value: boolean) { bootstrapComplete = value; }
// Called when graceful shutdown begins so readiness and traffic stop.
export function setShuttingDown(value: boolean) { shuttingDown = value; }

/** Build and return a configured Express app (does not listen). */
export function createApp(options: { probeDatabase?: () => Promise<unknown> } = {}) {
  // Fresh Express instance for this process (tests may call createApp repeatedly).
  const app = express();

  // Honor X-Forwarded-For when TRUST_PROXY=1 (needed for accurate rate-limit keys).
  configureTrustProxy(app);
  // Standard security response headers (Helmet).
  app.use(securityHeaders);
  // Attach request ids, latency metrics, and structured HTTP access logs.
  app.use(requestObservability);

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
      exposedHeaders: ["X-Next-Cursor", "X-Result-Truncated", "X-Attendance-Truncated", "X-Attendance-Total"],
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

  // Liveness probe has no database dependency.
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  // Alias liveness path used by newer probes/orchestrators.
  app.get("/health/live", (_req, res) => res.json({ ok: true }));
  // Readiness: bootstrap + not shutting down + successful DB probe.
  app.get("/health/ready", async (_req, res) => {
    // Stay 503 until defaults finish or while draining on shutdown.
    if (!bootstrapComplete || shuttingDown) return res.status(503).json({ ok: false, ready: false });
    try {
      // Injectable probe lets unit tests avoid a real Prisma round-trip.
      await (options.probeDatabase ?? (() => prisma.$transaction((tx) => tx.$queryRaw`SELECT 1`, { maxWait: 1000, timeout: 2000 })))();
      return res.json({ ok: true, ready: true });
    } catch {
      // DB unreachable — report which dependency failed for operators.
      return res.status(503).json({ ok: false, ready: false, dependency: "database" });
    }
  });
  // Prometheus exposition for scrape-based monitoring.
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4; charset=utf-8").send(renderMetrics());
  });
  // Reject new work once graceful shutdown has started.
  app.use((_req, res, next) => {
    if (shuttingDown) return res.status(503).json({ error: "shutting_down" });
    next();
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
      log.error("request_failed", {
        requestId: (res.getHeader("X-Request-Id") as string | undefined) ?? "unknown",
        error: safeErrorMessage(err),
      });
      return res.status(500).json({ error: "internal", message: "Internal server error" });
    },
  );

  return app;
}
