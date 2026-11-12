/**
 * Background job: flag running cleaning sessions older than overdueSessionMinutes
 * and notify assignees / sector supervisors.
 */
import { SessionStatus } from "@prisma/client";
// Cleaning sessions, tasks, and locations for overdue scan.
import { prisma } from "../../db";
// Operations settings supply overdueSessionMinutes threshold.
import { getOperations } from "../settings";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Live cleaning board SSE after session anomaly update.
import { publish } from "../../events/bus";
// Inbox rows for assignee, supervisor, and session starter.
import { createNotifications } from "../notifications";
// Import module ./runLifecycle for this service.
import { withJobRun } from "./runLifecycle";

/**
 * Scan and flag overdue running sessions; records a JobRun.
 * @returns How many sessions were scanned vs newly flagged overdue.
 */
export async function runOverdueSessions() {
  // Return the computed result to the caller.
  return withJobRun("overdue_sessions", async () => {
    // Threshold from operations settings (minutes a session may run).
    const operations = await getOperations();
    // Capture cutoff for use in this scope.
    const cutoff = new Date(
      // Run next step: Date.now() - operations.overdueSessionMinutes * 60 * 1000,
      Date.now() - operations.overdueSessionMinutes * 60 * 1000,
    );
    // Sessions started on or before cutoff are candidates for overdue flagging.

    // Running sessions that started at or before the cutoff.
    const sessions = await prisma.cleaningSession.findMany({
      // Set where on the structure being built.
      where: {
        // Set status on the structure being built.
        status: SessionStatus.running,
        // Set startedAt on the structure being built.
        startedAt: { lte: cutoff },
      },
      // Set select on the structure being built.
      select: {
        // Set id on the structure being built.
        id: true,
        // Set taskId on the structure being built.
        taskId: true,
        // Set anomalyFlags on the structure being built.
        anomalyFlags: true,
        // Set startedAt on the structure being built.
        startedAt: true,
        // Set employeeId on the structure being built.
        employeeId: true,
        // Set task on the structure being built.
        task: {
          // Set select on the structure being built.
          select: {
            // Set assignedEmployeeId on the structure being built.
            assignedEmployeeId: true,
            // Set sectorSupervisorEmployeeId on the structure being built.
            sectorSupervisorEmployeeId: true,
            // Set locationId on the structure being built.
            locationId: true,
            // Set location on the structure being built.
            location: { select: { number: true } },
          },
        },
      },
    });

    // Sessions that received a new overdue flag this run.
    let flagged = 0;
    // Iterate items to apply the same logic to each entry.
    for (const session of sessions) {
      // Normalize JSON anomalyFlags to a string array for membership checks.
      const flags = Array.isArray(session.anomalyFlags)
        // Complete the ternary or optional chain started above.
        ? (session.anomalyFlags as string[])
        // Complete the ternary or optional chain started above.
        : [];
      // A prior attempt may have persisted the flag but failed before notices.
      // Recheck flagged rows and reconcile notification delivery below.
      const newlyFlagged = !flags.includes("overdue");
      // Branch when this condition holds so the right path runs.
      if (newlyFlagged) {
        // Commit the state change and audit together. A crash after commit is
        // safe: the next run sees the flag and retries idempotent notifications.
        const changed = await prisma.$transaction(async (tx) => {
          // Load rows asynchronously for the next steps.
          const rows = await tx.$queryRaw<{ id: string }[]>`
            UPDATE "CleaningSession"
            SET "anomalyFlags" =
              (CASE WHEN jsonb_typeof("anomalyFlags") = 'array'
                THEN "anomalyFlags" ELSE '[]'::jsonb END) || '["overdue"]'::jsonb,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = ${session.id} AND status = 'running'
              AND "startedAt" <= ${cutoff}
              AND NOT (COALESCE("anomalyFlags", '[]'::jsonb) @> '["overdue"]'::jsonb)
            RETURNING id
          `;
          // Branch when this condition holds so the right path runs.
          if (rows.length === 0) return false;
          // Wait for the async step before continuing.
          await recordAudit({
            // Set actorEmployeeId on the structure being built.
            actorEmployeeId: null,
            // Set action on the structure being built.
            action: "session.overdue_detected",
            // Set entityType on the structure being built.
            entityType: "cleaning_session",
            // Set entityId on the structure being built.
            entityId: session.id,
            // Scope-filtered audit readers need the room; omit → invisible under sector scope.
            locationId: session.task.locationId,
            // Set summary on the structure being built.
            summary: `Overdue cleaning: ${session.task.location.number}`,
            // Set after on the structure being built.
            after: {
              // Set taskId on the structure being built.
              taskId: session.taskId,
              // Set startedAt on the structure being built.
              startedAt: session.startedAt.toISOString(),
              // Set overdueMinutes on the structure being built.
              overdueMinutes: operations.overdueSessionMinutes,
              // Set locationNumber on the structure being built.
              locationNumber: session.task.location.number,
              // Set sessionId on the structure being built.
              sessionId: session.id,
            },
          // Run next step: }, tx);
          }, tx);
          // Return the computed result to the caller.
          return true;
        });
        // Branch when this condition holds so the right path runs.
        if (!changed) continue;
        // Run next step: publish("cleaning.changed", {
        publish("cleaning.changed", {
          // Set taskId on the structure being built.
          taskId: session.taskId,
          // Set locationId on the structure being built.
          locationId: session.task.locationId,
        });
        // Run next step: flagged += 1;
        flagged += 1;
      }

      // Notify assignee, sector supervisor, and the employee who started the session.
      // Drop null assignee/supervisor ids; keep whoever started the session.
      const recipients = [
        // Run next step: session.task.assignedEmployeeId,
        session.task.assignedEmployeeId,
        // Run next step: session.task.sectorSupervisorEmployeeId,
        session.task.sectorSupervisorEmployeeId,
        // Run next step: session.employeeId,
        session.employeeId,
      // Run next step: ].filter((id): id is string => Boolean(id));
      ].filter((id): id is string => Boolean(id));
      // Wait for the async step before continuing.
      await createNotifications({
        // Set type on the structure being built.
        type: "cleaning.session_overdue",
        // Set title on the structure being built.
        title: "Cleaning session overdue",
        // Body uses room number from nested task → location select.
        body: `Room ${session.task.location.number} session past due`,
        // Set entityType on the structure being built.
        entityType: "cleaning_session",
        // Set entityId on the structure being built.
        entityId: session.id,
        // Set locationId on the structure being built.
        locationId: session.task.locationId,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: null,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: recipients,
        // One inbox row per session regardless of job rerun frequency.
        dedupeKey: `cleaning.session_overdue:${session.id}`,
        // Set payload on the structure being built.
        payload: {
          // Set panel on the structure being built.
          panel: "live",
          // Set taskId on the structure being built.
          taskId: session.taskId,
          // Set sessionId on the structure being built.
          sessionId: session.id,
          // Set locationId on the structure being built.
          locationId: session.task.locationId,
          // Set locationNumber on the structure being built.
          locationNumber: session.task.location.number,
        },
      });

      // createNotifications uses a stable unique key; any partial prior
      // recipient inserts are repaired without duplicating existing rows.
    }

    // Include cutoff ISO for debugging threshold drift on the JobRun summary.
    return {
      // Set scanned on the structure being built.
      scanned: sessions.length,
      // Run next step: flagged,
      flagged,
      // Set cutoff on the structure being built.
      cutoff: cutoff.toISOString(),
    };
  });
}
