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
import { sectorsRouter, shiftsRouter } from "./routes/sectors";
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

export function createApp() {
  const app = express();

  configureTrustProxy(app);
  app.use(securityHeaders);

  const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
          return cb(null, true);
        }
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(requireCsrf);
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

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

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
  app.use("/audit-events", auditRouter);
  app.use("/jobs", jobsRouter);
  app.use("/sync", syncRouter);
  app.use("/notifications", notificationsRouter);

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof AppError) {
        return res.status(err.status).json({
          error: err.code,
          message: err.message,
          details: err.details,
        });
      }
      console.error(err);
      return res.status(500).json({ error: "internal", message: "Internal server error" });
    },
  );

  return app;
}
