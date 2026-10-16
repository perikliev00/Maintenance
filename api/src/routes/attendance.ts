/**
 * /attendance — intervals, CSV export, ingest, and adjustment request/review.
 * Action gates differ: view vs ingest vs request/approve adjustment.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as attendanceController from "../controllers/attendance";

export const attendanceRouter = Router();

// GET /intervals — paginated attendance intervals (filters in query).
attendanceRouter.get(
  "/intervals",
  requireAuth,
  requireAction("attendance.view"),
  attendanceController.listIntervals,
);

// GET /intervals/:id — single interval detail for review UI.
attendanceRouter.get(
  "/intervals/:id",
  requireAuth,
  requireAction("attendance.view"),
  attendanceController.getInterval,
);

// GET /export.csv — download intervals as CSV for payroll/ops export.
attendanceRouter.get(
  "/export.csv",
  requireAuth,
  requireAction("attendance.view"),
  attendanceController.exportCsv,
);

// POST /events — ingest a raw attendance punch/event from a device or import.
attendanceRouter.post(
  "/events",
  requireAuth,
  requireAction("attendance.ingest"),
  attendanceController.ingestEvent,
);

// POST /adjustments — employee requests a correction to an interval.
attendanceRouter.post(
  "/adjustments",
  requireAuth,
  requireAction("attendance.request_adjustment"),
  attendanceController.requestAdjustment,
);

// POST /adjustments/:id/review — supervisor/manager approve or reject adjustment.
attendanceRouter.post(
  "/adjustments/:id/review",
  requireAuth,
  requireAction("attendance.approve_adjustment"),
  attendanceController.reviewAdjustment,
);
