/**
 * /attendance — intervals, CSV export, ingest, and adjustment request/review.
 * Action gates differ: view vs ingest vs request/approve adjustment.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as attendanceController from "../controllers/attendance";

// Create the Express router for attendance endpoints.
// Express router for attendance intervals, ingest, and adjustments.
export const attendanceRouter = Router();

// GET /intervals — paginated attendance intervals (filters in query).
attendanceRouter.get(
  "/intervals",
  // Require an authenticated session before reading intervals.
  requireAuth,
  // Authorize attendance.view for interval reads.
  requireAction("attendance.view"),
  // Delegate to the interval list controller with async error forwarding.
  asyncHandler(attendanceController.listIntervals),
);

// GET /intervals/:id — single interval detail for review UI.
attendanceRouter.get(
  "/intervals/:id",
  // Require an authenticated session before reading one interval.
  requireAuth,
  // Authorize attendance.view for interval detail.
  requireAction("attendance.view"),
  // Delegate to the interval detail controller with async error forwarding.
  asyncHandler(attendanceController.getInterval),
);

// GET /export.csv — download intervals as CSV for payroll/ops export.
attendanceRouter.get(
  "/export.csv",
  // Require an authenticated session before exporting CSV.
  requireAuth,
  // Export uses the same view permission as interval reads.
  requireAction("attendance.view"),
  // Delegate to the CSV export controller with async error forwarding.
  asyncHandler(attendanceController.exportCsv),
);

// POST /events — ingest a raw attendance punch/event from a device or import.
attendanceRouter.post(
  "/events",
  // Require an authenticated session before ingesting punches.
  requireAuth,
  // Authorize attendance.ingest for device/import writes.
  requireAction("attendance.ingest"),
  // Delegate to the ingest controller with async error forwarding.
  asyncHandler(attendanceController.ingestEvent),
);

// POST /adjustments — employee requests a correction to an interval.
attendanceRouter.post(
  "/adjustments",
  // Require an authenticated session before requesting adjustments.
  requireAuth,
  // Authorize attendance.request_adjustment for employee correction requests.
  requireAction("attendance.request_adjustment"),
  // Delegate to the adjustment request controller with async error forwarding.
  asyncHandler(attendanceController.requestAdjustment),
);

// POST /adjustments/:id/review — supervisor/manager approve or reject adjustment.
attendanceRouter.post(
  "/adjustments/:id/review",
  // Require an authenticated session before reviewing adjustments.
  requireAuth,
  // Authorize attendance.approve_adjustment for review decisions.
  requireAction("attendance.approve_adjustment"),
  // Delegate to the review controller with async error forwarding.
  asyncHandler(attendanceController.reviewAdjustment),
);
