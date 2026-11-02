/**
 * Attendance interval correction workflow: request a change, then approve
 * (freezes the interval as `adjusted`) or reject a pending adjustment.
 */
// Time-window validation and worked-minutes math for proposals.
import {
  assertValidAdjustmentTimes,
  computeWorkedMinutes,
} from "../attendanceRules";
// Reload interval DTO after review for API response.
import { getInterval } from "./reports";
// Module dependency import.
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  Role,
} from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
// Hotel timezone for rewriting hotelDate on approval.
import { getOperations } from "../settings";
// Module dependency import.
import { hotelDateAsUtcDate } from "../hotelTime";
import { recordAudit } from "../audit";
import {
  recipientsWithAction,
  type CreateNotificationInput,
} from "../notifications";
import {
  enqueueAttendanceNotice,
  tryDeliverAttendanceNotice,
} from "./notificationOutbox";

/** Outbox/notification dedupe keys: one request + one review notice per adjustment. */
const requestedNoticeKey = (adjustmentId: string) =>
  `attendance.adjustment_requested:${adjustmentId}`;
const reviewedNoticeKey = (adjustmentId: string) =>
  `attendance.adjustment_reviewed:${adjustmentId}`;

/**
 * Create a pending adjustment. Employees may only request their own intervals;
 * supervisors/managers/admins/owners may request for anyone. Closed intervals
 * move to `needs_review` while pending.
 */
export async function requestAdjustment(input: {
  intervalId: string;
  requestedById: string;
  actorRole: Role;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  // Load the interval being corrected.
  const interval = await prisma.attendanceInterval.findUnique({
    where: { id: input.intervalId },
  });
  // Guard / branch on preconditions.
  if (!interval) {
    // Fail closed with structured AppError.
    throw new AppError(404, "not_found", "Attendance interval not found");
  }

  // Field staff may only adjust their own; supervisors+ may adjust anyone.
  const isOwner = input.actorRole === Role.owner;
  // Local binding for this step.
  const privileged: Role[] = [
    Role.supervisor,
    Role.manager,
    Role.admin,
    Role.owner,
  ];
  // Local binding for this step.
  const isPrivileged = privileged.includes(input.actorRole);
  // Guard / branch on preconditions.
  if (
    !isOwner &&
    !isPrivileged &&
    interval.employeeId !== input.requestedById
  ) {
    // Fail closed with structured AppError.
    throw new AppError(
      403,
      "forbidden",
      "You can only request adjustments for your own intervals",
    );
  }

  // Reason is required for audit / reviewer context.
  const reason = input.reason.trim();
  // Guard / branch on preconditions.
  if (!reason) {
    // Fail closed with structured AppError.
    throw new AppError(400, "validation", "Reason is required");
  }

  // Parse optional proposed times; invalid ISO → 400.
  const proposedStartedAt = input.proposedStartedAt
    ? new Date(input.proposedStartedAt)
    : null;
  // Local binding for this step.
  const proposedEndedAt = input.proposedEndedAt
    ? new Date(input.proposedEndedAt)
    : null;
  // Guard / branch on preconditions.
  if (proposedStartedAt && Number.isNaN(proposedStartedAt.getTime())) {
    // Fail closed with structured AppError.
    throw new AppError(400, "validation", "Invalid proposedStartedAt");
  }
  // Guard / branch on preconditions.
  if (proposedEndedAt && Number.isNaN(proposedEndedAt.getTime())) {
    // Fail closed with structured AppError.
    throw new AppError(400, "validation", "Invalid proposedEndedAt");
  }

  // Effective values = proposal overlay on current interval fields.
  const effStart = proposedStartedAt ?? interval.startedAt;
  // Local binding for this step.
  const effEnd = proposedEndedAt ?? interval.endedAt;
  // Local binding for this step.
  const effBreak = input.proposedBreakMinutes ?? interval.breakMinutes;
  // Reject inverted / impossible time windows.
  assertValidAdjustmentTimes(effStart, effEnd, effBreak);

  // Recipients are read before the TX; the notice itself is snapshotted into
  // the outbox inside the TX so it commits (or rolls back) with the request.
  const recipients = await recipientsWithAction(
    "attendance.approve_adjustment",
  );

  // Request row + needs_review flip + required audit + notice intent commit
  // atomically. An audit/outbox failure rolls everything back so a retry
  // starts from a clean state (no orphan pending adjustment).
  const adj = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceAdjustment.create({
      data: {
        // Target interval under correction.
        intervalId: interval.id,
        requestedById: input.requestedById,
        reason,
        proposedStartedAt,
        proposedEndedAt,
        proposedBreakMinutes: input.proposedBreakMinutes ?? null,
        // All new requests start pending until reviewed.
        status: AttendanceAdjustmentStatus.pending,
      },
    });

    // Closed intervals enter needs_review while a pending adjustment exists.
    if (interval.status === AttendanceIntervalStatus.closed) {
      await tx.attendanceInterval.update({
        where: { id: interval.id },
        data: { status: AttendanceIntervalStatus.needs_review },
      });
    }

    // Required audit: same TX as the business write.
    await recordAudit(
      {
        actorEmployeeId: input.requestedById,
        action: "adjustment.request",
        entityType: "attendance_adjustment",
        entityId: created.id,
        reason,
        after: {
          intervalId: interval.id,
          proposedStartedAt,
          proposedEndedAt,
          proposedBreakMinutes: input.proposedBreakMinutes ?? null,
        },
        summary: `Requested attendance adjustment`,
      },
      tx,
    );

    // Durable notify intent for anyone who can approve adjustments.
    await enqueueAttendanceNotice(tx, {
      type: "attendance.adjustment_requested",
      title: "Attendance adjustment requested",
      body: "A team member requested an attendance adjustment",
      entityType: "attendance_adjustment",
      entityId: created.id,
      actorEmployeeId: input.requestedById,
      recipientEmployeeIds: recipients,
      dedupeKey: requestedNoticeKey(created.id),
      payload: {
        panel: "attendance",
        adjustmentId: created.id,
      },
    });

    return created;
  });

  // Post-commit best-effort delivery; failure never fails the request.
  await tryDeliverAttendanceNotice(requestedNoticeKey(adj.id));

  // Return result to caller.
  return adj;
}

/**
 * Approve or reject a pending adjustment. Approval applies proposed times,
 * clears anomaly flags, and sets status `adjusted` (skipped by rebuild).
 * Concurrent reviews fail with 409 via conditional updateMany.
 */
export async function reviewAdjustment(input: {
  adjustmentId: string;
  reviewedById: string;
  /** Terminal reviewer decision — drives interval mutation on approve only. */
  decision: "approved" | "rejected";
  reason?: string;
}) {
  // Await async query or service call.
  const adj = await prisma.attendanceAdjustment.findUnique({
    where: { id: input.adjustmentId },
    include: { interval: true },
  });
  // Guard / branch on preconditions.
  if (!adj) {
    // Fail closed with structured AppError.
    throw new AppError(404, "not_found", "Adjustment not found");
  }
  // Already approved/rejected — never re-apply. A retry of the SAME decision by
  // the SAME reviewer (e.g. response lost after commit) is an idempotent
  // success: return current state and re-attempt the pending notice.
  if (adj.status !== AttendanceAdjustmentStatus.pending) {
    const sameDecision =
      adj.status ===
      (input.decision === "approved"
        ? AttendanceAdjustmentStatus.approved
        : AttendanceAdjustmentStatus.rejected);
    if (sameDecision && adj.reviewedById === input.reviewedById) {
      await tryDeliverAttendanceNotice(reviewedNoticeKey(adj.id));
      return getInterval(adj.intervalId);
    }
    // Fail closed with structured AppError.
    throw new AppError(409, "conflict", "Adjustment already reviewed");
  }

  // Local binding for this step.
  const reviewedAt = new Date();
  // Overlay proposed fields onto the current interval values.
  const startedAt = adj.proposedStartedAt ?? adj.interval.startedAt;
  // Local binding for this step.
  const endedAt = adj.proposedEndedAt ?? adj.interval.endedAt;
  // Local binding for this step.
  const breakMinutes =
    adj.proposedBreakMinutes ?? adj.interval.breakMinutes;
  // Guard / branch on preconditions.
  if (input.decision === "approved") {
    assertValidAdjustmentTimes(startedAt, endedAt, breakMinutes);
  }
  // Local binding for this step.
  const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
  // Hotel timezone needed only when rewriting hotelDate on approve.
  const ops =
    input.decision === "approved" ? await getOperations() : null;

  // Notice snapshot is built from pre-TX data and enqueued inside the TX.
  const approved = input.decision === "approved";
  const notice: CreateNotificationInput = {
    type: "attendance.adjustment_reviewed",
    title: approved
      ? "Attendance adjustment approved"
      : "Attendance adjustment rejected",
    body: approved
      ? "Your attendance adjustment was approved"
      : "Your attendance adjustment was rejected",
    entityType: "attendance_adjustment",
    entityId: adj.id,
    actorEmployeeId: input.reviewedById,
    recipientEmployeeIds: [adj.requestedById],
    dedupeKey: reviewedNoticeKey(adj.id),
    payload: {
      panel: "attendance",
      adjustmentId: adj.id,
    },
  };

  // Decision claim + interval write + required audit + notice intent commit
  // atomically. If audit/outbox fails, everything rolls back: the adjustment
  // stays `pending` and the client can retry the same review.
  await prisma.$transaction(async (tx) => {
    // Conditional claim so concurrent reviewers cannot double-apply.
    const claimed = await tx.attendanceAdjustment.updateMany({
      where: {
        id: adj.id,
        status: AttendanceAdjustmentStatus.pending,
      },
      data: {
        // Terminal status from reviewer decision.
        status: approved
          ? AttendanceAdjustmentStatus.approved
          : AttendanceAdjustmentStatus.rejected,
        reviewedById: input.reviewedById,
        reviewedAt,
        // Reject may replace reason with reviewer note.
        ...(!approved
          ? { reason: input.reason?.trim() || adj.reason }
          : {}),
      },
    });
    // Guard / branch on preconditions.
    if (claimed.count === 0) {
      // Fail closed with structured AppError.
      throw new AppError(409, "conflict", "Adjustment already reviewed");
    }

    // Apply proposed times and freeze as `adjusted` (rebuild skips these).
    if (approved && ops) {
      await tx.attendanceInterval.update({
        where: { id: adj.intervalId },
        data: {
          startedAt,
          endedAt,
          breakMinutes,
          workedMinutes,
          // Re-key hotelDate column to approved start in hotel TZ.
          hotelDate: hotelDateAsUtcDate(startedAt, ops.hotelTimezone),
          // Freeze interval — rebuild will skip punches in this range.
          status: AttendanceIntervalStatus.adjusted,
          // Clear auto-detected anomalies after manual correction.
          anomalyFlags: [],
        },
      });
    }

    // Required audit: same TX as the decision/interval write.
    await recordAudit(
      approved
        ? {
            actorEmployeeId: input.reviewedById,
            action: "adjustment.review",
            entityType: "attendance_adjustment",
            entityId: adj.id,
            after: {
              decision: "approved",
              intervalId: adj.intervalId,
              startedAt,
              endedAt,
              breakMinutes,
            },
            summary: `Approved attendance adjustment`,
          }
        : {
            actorEmployeeId: input.reviewedById,
            action: "adjustment.review",
            entityType: "attendance_adjustment",
            entityId: adj.id,
            reason: input.reason,
            after: { decision: "rejected", intervalId: adj.intervalId },
            summary: `Rejected attendance adjustment`,
          },
      tx,
    );

    // Durable notify intent for the requester.
    await enqueueAttendanceNotice(tx, notice);
  });

  // Post-commit best-effort delivery; failure never fails the review.
  await tryDeliverAttendanceNotice(reviewedNoticeKey(adj.id));

  // Return result to caller.
  return getInterval(adj.intervalId);
}
