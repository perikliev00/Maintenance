/**
 * Attendance interval correction workflow: request a change, then approve
 * (freezes the interval as `adjusted`) or reject a pending adjustment.
 */
// Time-window validation and worked-minutes math for proposals.
import {
  assertValidAdjustmentTimes,
  computeWorkedMinutes,
// Support the surrounding control flow.
} from "../attendanceRules";
// Reload interval DTO after review for API response.
import { getInterval } from "./reports";
// Module dependency import.
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  Role,
// Support the surrounding control flow.
} from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
// Hotel timezone for rewriting hotelDate on approval.
import { getOperations } from "../settings";
// Module dependency import.
import { hotelDateAsUtcDate } from "../hotelTime";
// Runtime import from ../audit.
import { recordAudit } from "../audit";
// Module import required below.
import {
  recipientsWithAction,
  // Type alias CreateNotificationInput.
  type CreateNotificationInput,
// Support the surrounding control flow.
} from "../notifications";
// Module import required below.
import {
  enqueueAttendanceNotice,
  tryDeliverAttendanceNotice,
// Support the surrounding control flow.
} from "./notificationOutbox";

/** Outbox/notification dedupe keys: one request + one review notice per adjustment. */
const requestedNoticeKey = (adjustmentId: string) =>
  // Support the surrounding control flow.
  `attendance.adjustment_requested:${adjustmentId}`;
// Local reviewedNoticeKey used below.
const reviewedNoticeKey = (adjustmentId: string) =>
  // Support the surrounding control flow.
  `attendance.adjustment_reviewed:${adjustmentId}`;

/**
 * Create a pending adjustment. Employees may only request their own intervals;
 * supervisors/managers/admins/owners may request for anyone. Closed intervals
 * move to `needs_review` while pending.
 */
export async function requestAdjustment(input: {
  // Param intervalId required by this function.
  intervalId: string;
  // Param requestedById required by this function.
  requestedById: string;
  // Param actorRole required by this function.
  actorRole: Role;
  // Param reason required by this function.
  reason: string;
  // Param proposedStartedAt required by this function.
  proposedStartedAt?: string;
  // Param proposedEndedAt required by this function.
  proposedEndedAt?: string;
  // Param proposedBreakMinutes required by this function.
  proposedBreakMinutes?: number;
// Support the surrounding control flow.
}) {
  // Load the interval being corrected.
  const interval = await prisma.attendanceInterval.findUnique({
    // Filter matching rows.
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
    // Support the surrounding control flow.
    Role.supervisor,
    // Support the surrounding control flow.
    Role.manager,
    // Support the surrounding control flow.
    Role.admin,
    // Support the surrounding control flow.
    Role.owner,
  ];
  // Local binding for this step.
  const isPrivileged = privileged.includes(input.actorRole);
  // Guard / branch on preconditions.
  if (
    // Additional clause in this boolean decision.
    !isOwner &&
    // Additional clause in this boolean decision.
    !isPrivileged &&
    // Support the surrounding control flow.
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
    // Support the surrounding control flow.
    ? new Date(input.proposedStartedAt)
    // Support the surrounding control flow.
    : null;
  // Local binding for this step.
  const proposedEndedAt = input.proposedEndedAt
    // Support the surrounding control flow.
    ? new Date(input.proposedEndedAt)
    // Support the surrounding control flow.
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
    // Await created before dependent work.
    const created = await tx.attendanceAdjustment.create({
      // Mutation data payload.
      data: {
        // Target interval under correction.
        intervalId: interval.id,
        // Field requestedById on this type/payload.
        requestedById: input.requestedById,
        reason,
        proposedStartedAt,
        proposedEndedAt,
        // Field proposedBreakMinutes on this type/payload.
        proposedBreakMinutes: input.proposedBreakMinutes ?? null,
        // All new requests start pending until reviewed.
        status: AttendanceAdjustmentStatus.pending,
      },
    });

    // Closed intervals enter needs_review while a pending adjustment exists.
    if (interval.status === AttendanceIntervalStatus.closed) {
      // Await side effect before continuing.
      await tx.attendanceInterval.update({
        // Filter matching rows.
        where: { id: interval.id },
        // Mutation data payload.
        data: { status: AttendanceIntervalStatus.needs_review },
      });
    }

    // Required audit: same TX as the business write.
    await recordAudit(
      // Support the surrounding control flow.
      {
        // Set actorEmployeeId.
        actorEmployeeId: input.requestedById,
        // Set action.
        action: "adjustment.request",
        // Set entityType.
        entityType: "attendance_adjustment",
        // Set entityId.
        entityId: created.id,
        reason,
        // Field after on this type/payload.
        after: {
          // Field intervalId on this type/payload.
          intervalId: interval.id,
          proposedStartedAt,
          proposedEndedAt,
          // Field proposedBreakMinutes on this type/payload.
          proposedBreakMinutes: input.proposedBreakMinutes ?? null,
        },
        // Set summary.
        summary: `Requested attendance adjustment`,
      },
      tx,
    );

    // Durable notify intent for anyone who can approve adjustments.
    await enqueueAttendanceNotice(tx, {
      // Set type.
      type: "attendance.adjustment_requested",
      // Set title.
      title: "Attendance adjustment requested",
      // Set body.
      body: "A team member requested an attendance adjustment",
      // Set entityType.
      entityType: "attendance_adjustment",
      // Set entityId.
      entityId: created.id,
      // Set actorEmployeeId.
      actorEmployeeId: input.requestedById,
      // Set recipientEmployeeIds.
      recipientEmployeeIds: recipients,
      // Set dedupeKey.
      dedupeKey: requestedNoticeKey(created.id),
      // Field payload on this type/payload.
      payload: {
        // Field panel on this type/payload.
        panel: "attendance",
        // Field adjustmentId on this type/payload.
        adjustmentId: created.id,
      },
    });

    // Return computed result.
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
  // Param adjustmentId required by this function.
  adjustmentId: string;
  // Param reviewedById required by this function.
  reviewedById: string;
  /** Terminal reviewer decision — drives interval mutation on approve only. */
  decision: "approved" | "rejected";
  // Param reason required by this function.
  reason?: string;
// Support the surrounding control flow.
}) {
  // Await async query or service call.
  const adj = await prisma.attendanceAdjustment.findUnique({
    // Filter matching rows.
    where: { id: input.adjustmentId },
    // Include relations for labels/checks.
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
    // Local sameDecision used below.
    const sameDecision =
      // Assign adj.status.
      adj.status ===
      // Support the surrounding control flow.
      (input.decision === "approved"
        // Support the surrounding control flow.
        ? AttendanceAdjustmentStatus.approved
        // Support the surrounding control flow.
        : AttendanceAdjustmentStatus.rejected);
    // Conditional path for this guard.
    if (sameDecision && adj.reviewedById === input.reviewedById) {
      // Await side effect before continuing.
      await tryDeliverAttendanceNotice(reviewedNoticeKey(adj.id));
      // Return computed result.
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
    // Support the surrounding control flow.
    adj.proposedBreakMinutes ?? adj.interval.breakMinutes;
  // Guard / branch on preconditions.
  if (input.decision === "approved") {
    // Invoke assertValidAdjustmentTimes.
    assertValidAdjustmentTimes(startedAt, endedAt, breakMinutes);
  }
  // Local binding for this step.
  const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
  // Hotel timezone needed only when rewriting hotelDate on approve.
  const ops =
    // Assign input.decision.
    input.decision === "approved" ? await getOperations() : null;

  // Notice snapshot is built from pre-TX data and enqueued inside the TX.
  const approved = input.decision === "approved";
  // Local notice used below.
  const notice: CreateNotificationInput = {
    // Param type required by this function.
    type: "attendance.adjustment_reviewed",
    // Param title required by this function.
    title: approved
      // Support the surrounding control flow.
      ? "Attendance adjustment approved"
      // Support the surrounding control flow.
      : "Attendance adjustment rejected",
    // Param body required by this function.
    body: approved
      // Support the surrounding control flow.
      ? "Your attendance adjustment was approved"
      // Support the surrounding control flow.
      : "Your attendance adjustment was rejected",
    // Param entityType required by this function.
    entityType: "attendance_adjustment",
    // Param entityId required by this function.
    entityId: adj.id,
    // Param actorEmployeeId required by this function.
    actorEmployeeId: input.reviewedById,
    // Param recipientEmployeeIds required by this function.
    recipientEmployeeIds: [adj.requestedById],
    // Param dedupeKey required by this function.
    dedupeKey: reviewedNoticeKey(adj.id),
    // Param payload required by this function.
    payload: {
      // Param panel required by this function.
      panel: "attendance",
      // Param adjustmentId required by this function.
      adjustmentId: adj.id,
    },
  };

  // Decision claim + interval write + required audit + notice intent commit
  // atomically. If audit/outbox fails, everything rolls back: the adjustment
  // stays `pending` and the client can retry the same review.
  await prisma.$transaction(async (tx) => {
    // Conditional claim so concurrent reviewers cannot double-apply.
    const claimed = await tx.attendanceAdjustment.updateMany({
      // Filter matching rows.
      where: {
        // Param id required by this function.
        id: adj.id,
        // Param status required by this function.
        status: AttendanceAdjustmentStatus.pending,
      },
      // Mutation data payload.
      data: {
        // Terminal status from reviewer decision.
        status: approved
          // Support the surrounding control flow.
          ? AttendanceAdjustmentStatus.approved
          // Support the surrounding control flow.
          : AttendanceAdjustmentStatus.rejected,
        // Param reviewedById required by this function.
        reviewedById: input.reviewedById,
        reviewedAt,
        // Reject may replace reason with reviewer note.
        ...(!approved
          // Support the surrounding control flow.
          ? { reason: input.reason?.trim() || adj.reason }
          // Support the surrounding control flow.
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
      // Await side effect before continuing.
      await tx.attendanceInterval.update({
        // Filter matching rows.
        where: { id: adj.intervalId },
        // Mutation data payload.
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
      // Support the surrounding control flow.
      approved
        // Support the surrounding control flow.
        ? {
            // Param actorEmployeeId required by this function.
            actorEmployeeId: input.reviewedById,
            // Param action required by this function.
            action: "adjustment.review",
            // Param entityType required by this function.
            entityType: "attendance_adjustment",
            // Param entityId required by this function.
            entityId: adj.id,
            // Param after required by this function.
            after: {
              // Param decision required by this function.
              decision: "approved",
              // Param intervalId required by this function.
              intervalId: adj.intervalId,
              startedAt,
              endedAt,
              breakMinutes,
            },
            // Param summary required by this function.
            summary: `Approved attendance adjustment`,
          }
        // Support the surrounding control flow.
        : {
            // Param actorEmployeeId required by this function.
            actorEmployeeId: input.reviewedById,
            // Param action required by this function.
            action: "adjustment.review",
            // Param entityType required by this function.
            entityType: "attendance_adjustment",
            // Param entityId required by this function.
            entityId: adj.id,
            // Param reason required by this function.
            reason: input.reason,
            // Param after required by this function.
            after: { decision: "rejected", intervalId: adj.intervalId },
            // Param summary required by this function.
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
