/**
 * Background job: flag running cleaning sessions older than overdueSessionMinutes
 * and notify assignees / sector supervisors.
 */
import { SessionStatus } from "@prisma/client";
// Cleaning sessions, tasks, and locations for overdue scan.
import { prisma } from "../../db";
// Operations settings supply overdueSessionMinutes threshold.
import { getOperations } from "../settings";
import { recordAudit } from "../audit";
// Live cleaning board SSE after session anomaly update.
import { publish } from "../../events/bus";
// Inbox rows for assignee, supervisor, and session starter.
import { createNotifications } from "../notifications";
import { startJobRun, finishJobRun } from "./runLifecycle";

/**
 * Scan and flag overdue running sessions; records a JobRun.
 * @returns How many sessions were scanned vs newly flagged overdue.
 */
export async function runOverdueSessions() {
  // JobRun row tracks start/finish for ops dashboards.
  const run = await startJobRun("overdue_sessions");
  try {
    // Threshold from operations settings (minutes a session may run).
    const operations = await getOperations();
    const cutoff = new Date(
      Date.now() - operations.overdueSessionMinutes * 60 * 1000,
    );
    // Sessions started on or before cutoff are candidates for overdue flagging.

    // Running sessions that started at or before the cutoff.
    const sessions = await prisma.cleaningSession.findMany({
      where: {
        status: SessionStatus.running,
        startedAt: { lte: cutoff },
      },
      select: {
        id: true,
        taskId: true,
        anomalyFlags: true,
        startedAt: true,
        employeeId: true,
        task: {
          select: {
            assignedEmployeeId: true,
            sectorSupervisorEmployeeId: true,
            locationId: true,
            location: { select: { number: true } },
          },
        },
      },
    });

    // Sessions that received a new overdue flag this run.
    let flagged = 0;
    for (const session of sessions) {
      // Normalize JSON anomalyFlags to a string array for membership checks.
      const flags = Array.isArray(session.anomalyFlags)
        ? (session.anomalyFlags as string[])
        : [];
      // Skip sessions already stamped with the overdue anomaly flag.
      if (flags.includes("overdue")) continue;

      // Append "overdue" without dropping any prior anomaly flags.
      await prisma.cleaningSession.update({
        where: { id: session.id },
        data: {
          // Persist merged flags array (Prisma JSON column).
          anomalyFlags: [...flags, "overdue"],
        },
      });
      // System audit (null actor) for the overdue detection.
      await recordAudit({
        actorEmployeeId: null,
        action: "session.overdue_detected",
        entityType: "cleaning_session",
        entityId: session.id,
        after: {
          taskId: session.taskId,
          startedAt: session.startedAt.toISOString(),
          // Threshold at detection time for audit forensics.
          overdueMinutes: operations.overdueSessionMinutes,
        },
      });
      // Refresh live cleaning board subscribers for this task.
      publish("cleaning.changed", { taskId: session.taskId });

      // Notify assignee, sector supervisor, and the employee who started the session.
      // Drop null assignee/supervisor ids; keep whoever started the session.
      const recipients = [
        session.task.assignedEmployeeId,
        session.task.sectorSupervisorEmployeeId,
        session.employeeId,
      ].filter((id): id is string => Boolean(id));
      await createNotifications({
        type: "cleaning.session_overdue",
        title: "Cleaning session overdue",
        // Body uses room number from nested task → location select.
        body: `Room ${session.task.location.number} session past due`,
        entityType: "cleaning_session",
        entityId: session.id,
        locationId: session.task.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        // One inbox row per session regardless of job rerun frequency.
        dedupeKey: `cleaning.session_overdue:${session.id}`,
        payload: {
          panel: "live",
          taskId: session.taskId,
          sessionId: session.id,
          locationId: session.task.locationId,
          locationNumber: session.task.location.number,
        },
      });

      // Count only sessions that completed the full flag/audit/notify path.
      flagged += 1;
    }

    // Success summary includes cutoff ISO for debugging threshold drift.
    await finishJobRun(run.id, "ok", {
      scanned: sessions.length,
      flagged,
      cutoff: cutoff.toISOString(),
    });
    return { scanned: sessions.length, flagged };
  } catch (err) {
    // Capture message for JobRun.error regardless of throw type.
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    // Re-throw after persisting error on the JobRun row.
    throw err;
  }
}
