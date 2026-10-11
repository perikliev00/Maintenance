import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as attendanceController from "../controllers/attendance";

export const attendanceRouter = Router();

attendanceRouter.get(
  "/intervals",
  requireAuth,
  requireAction("attendance.view"),
  attendanceController.listIntervals,
);

attendanceRouter.get(
  "/intervals/:id",
  requireAuth,
  requireAction("attendance.view"),
  attendanceController.getInterval,
);

attendanceRouter.get(
  "/export.csv",
  requireAuth,
  requireAction("attendance.view"),
  attendanceController.exportCsv,
);

attendanceRouter.post(
  "/events",
  requireAuth,
  requireAction("attendance.ingest"),
  attendanceController.ingestEvent,
);

attendanceRouter.post(
  "/adjustments",
  requireAuth,
  requireAction("attendance.request_adjustment"),
  attendanceController.requestAdjustment,
);

attendanceRouter.post(
  "/adjustments/:id/review",
  requireAuth,
  requireAction("attendance.approve_adjustment"),
  attendanceController.reviewAdjustment,
);
