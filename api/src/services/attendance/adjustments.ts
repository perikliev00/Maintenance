import {
  assertValidAdjustmentTimes,
  computeWorkedMinutes,
} from "../attendanceRules";
import { getInterval } from "../attendanceReports";
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  Role,
} from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { getOperations } from "../settings";
import { hotelDateAsUtcDate } from "../hotelTime";
import { recordAudit } from "../audit";
import {
  createNotifications,
  recipientsWithAction,
} from "../notifications";

export async function requestAdjustment(input: {
  intervalId: string;
  requestedById: string;
  actorRole: Role;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  const interval = await prisma.attendanceInterval.findUnique({
    where: { id: input.intervalId },
  });
  if (!interval) {
    throw new AppError(404, "not_found", "Attendance interval not found");
  }

  const isOwner = input.actorRole === Role.owner;
  const privileged: Role[] = [
    Role.supervisor,
    Role.manager,
    Role.admin,
    Role.owner,
  ];
  const isPrivileged = privileged.includes(input.actorRole);
  if (
    !isOwner &&
    !isPrivileged &&
    interval.employeeId !== input.requestedById
  ) {
    throw new AppError(
      403,
      "forbidden",
      "You can only request adjustments for your own intervals",
    );
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new AppError(400, "validation", "Reason is required");
  }

  const proposedStartedAt = input.proposedStartedAt
    ? new Date(input.proposedStartedAt)
    : null;
  const proposedEndedAt = input.proposedEndedAt
    ? new Date(input.proposedEndedAt)
    : null;
  if (proposedStartedAt && Number.isNaN(proposedStartedAt.getTime())) {
    throw new AppError(400, "validation", "Invalid proposedStartedAt");
  }
  if (proposedEndedAt && Number.isNaN(proposedEndedAt.getTime())) {
    throw new AppError(400, "validation", "Invalid proposedEndedAt");
  }

  const effStart = proposedStartedAt ?? interval.startedAt;
  const effEnd = proposedEndedAt ?? interval.endedAt;
  const effBreak = input.proposedBreakMinutes ?? interval.breakMinutes;
  assertValidAdjustmentTimes(effStart, effEnd, effBreak);

  const adj = await prisma.attendanceAdjustment.create({
    data: {
      intervalId: interval.id,
      requestedById: input.requestedById,
      reason,
      proposedStartedAt,
      proposedEndedAt,
      proposedBreakMinutes: input.proposedBreakMinutes ?? null,
      status: AttendanceAdjustmentStatus.pending,
    },
  });

  if (interval.status === AttendanceIntervalStatus.closed) {
    await prisma.attendanceInterval.update({
      where: { id: interval.id },
      data: { status: AttendanceIntervalStatus.needs_review },
    });
  }

  await recordAudit({
    actorEmployeeId: input.requestedById,
    action: "adjustment.request",
    entityType: "attendance_adjustment",
    entityId: adj.id,
    reason,
    after: {
      intervalId: interval.id,
      proposedStartedAt,
      proposedEndedAt,
      proposedBreakMinutes: input.proposedBreakMinutes ?? null,
    },
    summary: `Requested attendance adjustment`,
  });

  {
    const recipients = await recipientsWithAction(
      "attendance.approve_adjustment",
    );
    await createNotifications({
      type: "attendance.adjustment_requested",
      title: "Attendance adjustment requested",
      body: "A team member requested an attendance adjustment",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      actorEmployeeId: input.requestedById,
      recipientEmployeeIds: recipients,
      dedupeKey: `attendance.adjustment_requested:${adj.id}`,
      payload: {
        panel: "attendance",
        adjustmentId: adj.id,
      },
    });
  }

  return adj;
}

export async function reviewAdjustment(input: {
  adjustmentId: string;
  reviewedById: string;
  decision: "approved" | "rejected";
  reason?: string;
}) {
  const adj = await prisma.attendanceAdjustment.findUnique({
    where: { id: input.adjustmentId },
    include: { interval: true },
  });
  if (!adj) {
    throw new AppError(404, "not_found", "Adjustment not found");
  }
  if (adj.status !== AttendanceAdjustmentStatus.pending) {
    throw new AppError(409, "conflict", "Adjustment already reviewed");
  }

  const reviewedAt = new Date();
  const startedAt = adj.proposedStartedAt ?? adj.interval.startedAt;
  const endedAt = adj.proposedEndedAt ?? adj.interval.endedAt;
  const breakMinutes =
    adj.proposedBreakMinutes ?? adj.interval.breakMinutes;
  if (input.decision === "approved") {
    assertValidAdjustmentTimes(startedAt, endedAt, breakMinutes);
  }
  const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
  const ops =
    input.decision === "approved" ? await getOperations() : null;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.attendanceAdjustment.updateMany({
      where: {
        id: adj.id,
        status: AttendanceAdjustmentStatus.pending,
      },
      data: {
        status:
          input.decision === "rejected"
            ? AttendanceAdjustmentStatus.rejected
            : AttendanceAdjustmentStatus.approved,
        reviewedById: input.reviewedById,
        reviewedAt,
        ...(input.decision === "rejected"
          ? { reason: input.reason?.trim() || adj.reason }
          : {}),
      },
    });
    if (claimed.count === 0) {
      throw new AppError(409, "conflict", "Adjustment already reviewed");
    }

    if (input.decision === "approved" && ops) {
      await tx.attendanceInterval.update({
        where: { id: adj.intervalId },
        data: {
          startedAt,
          endedAt,
          breakMinutes,
          workedMinutes,
          hotelDate: hotelDateAsUtcDate(startedAt, ops.hotelTimezone),
          status: AttendanceIntervalStatus.adjusted,
          anomalyFlags: [],
        },
      });
    }
  });

  if (input.decision === "rejected") {
    await recordAudit({
      actorEmployeeId: input.reviewedById,
      action: "adjustment.review",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      reason: input.reason,
      after: { decision: "rejected", intervalId: adj.intervalId },
      summary: `Rejected attendance adjustment`,
    });
    await createNotifications({
      type: "attendance.adjustment_reviewed",
      title: "Attendance adjustment rejected",
      body: "Your attendance adjustment was rejected",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      actorEmployeeId: input.reviewedById,
      recipientEmployeeIds: [adj.requestedById],
      dedupeKey: `attendance.adjustment_reviewed:${adj.id}`,
      payload: {
        panel: "attendance",
        adjustmentId: adj.id,
      },
    });
    return getInterval(adj.intervalId);
  }

  await recordAudit({
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
  });

  await createNotifications({
    type: "attendance.adjustment_reviewed",
    title: "Attendance adjustment approved",
    body: "Your attendance adjustment was approved",
    entityType: "attendance_adjustment",
    entityId: adj.id,
    actorEmployeeId: input.reviewedById,
    recipientEmployeeIds: [adj.requestedById],
    dedupeKey: `attendance.adjustment_reviewed:${adj.id}`,
    payload: {
      panel: "attendance",
      adjustmentId: adj.id,
    },
  });

  return getInterval(adj.intervalId);
}
