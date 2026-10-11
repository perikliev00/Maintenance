import { SessionStatus } from "@prisma/client";
import { prisma } from "../../db";
import { getOperations } from "../settings";
import { recordAudit } from "../audit";
import { publish } from "../../events/bus";
import { createNotifications } from "../notifications";
import { startJobRun, finishJobRun } from "./runLifecycle";

export async function runOverdueSessions() {
  const run = await startJobRun("overdue_sessions");
  try {
    const operations = await getOperations();
    const cutoff = new Date(
      Date.now() - operations.overdueSessionMinutes * 60 * 1000,
    );

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

    let flagged = 0;
    for (const session of sessions) {
      const flags = Array.isArray(session.anomalyFlags)
        ? (session.anomalyFlags as string[])
        : [];
      if (flags.includes("overdue")) continue;

      await prisma.cleaningSession.update({
        where: { id: session.id },
        data: {
          anomalyFlags: [...flags, "overdue"],
        },
      });
      await recordAudit({
        actorEmployeeId: null,
        action: "session.overdue_detected",
        entityType: "cleaning_session",
        entityId: session.id,
        after: {
          taskId: session.taskId,
          startedAt: session.startedAt.toISOString(),
          overdueMinutes: operations.overdueSessionMinutes,
        },
      });
      publish("cleaning.changed", { taskId: session.taskId });

      const recipients = [
        session.task.assignedEmployeeId,
        session.task.sectorSupervisorEmployeeId,
        session.employeeId,
      ].filter((id): id is string => Boolean(id));
      await createNotifications({
        type: "cleaning.session_overdue",
        title: "Cleaning session overdue",
        body: `Room ${session.task.location.number} session past due`,
        entityType: "cleaning_session",
        entityId: session.id,
        locationId: session.task.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        dedupeKey: `cleaning.session_overdue:${session.id}`,
        payload: {
          panel: "live",
          taskId: session.taskId,
          sessionId: session.id,
          locationId: session.task.locationId,
          locationNumber: session.task.location.number,
        },
      });

      flagged += 1;
    }

    await finishJobRun(run.id, "ok", {
      scanned: sessions.length,
      flagged,
      cutoff: cutoff.toISOString(),
    });
    return { scanned: sessions.length, flagged };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}
