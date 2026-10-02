import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { cleaningRouter } from "./routes/cleaning";
import { maintenanceRouter } from "./routes/maintenance";
import { peopleRouter } from "./routes/people";
import { AppError } from "./services/cleaning";

export function createApp() {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/rooms", roomsRouter);
  app.use("/cleaning", cleaningRouter);
  app.use("/maintenance", maintenanceRouter);
  app.use("/people", peopleRouter);

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
