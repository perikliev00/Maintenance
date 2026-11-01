/**
 * Backfill historical SLA / overdue audit rows that were written without
 * locationId (pre BUG-01). Safe to re-run; only updates null locationId rows.
 */
import { prisma } from "../db";

export type AuditLocationBackfillResult = {
  slaUpdated: number;
  overdueUpdated: number;
};

/** Fill null locationId on ticket.sla_breach / session.overdue_detected rows. */
export async function backfillAuditLocationIds(): Promise<AuditLocationBackfillResult> {
  const sla = await prisma.$executeRaw`
    UPDATE "AuditEvent" AS ae
    SET "locationId" = mt."locationId"
    FROM "MaintenanceTicket" AS mt
    WHERE ae."locationId" IS NULL
      AND ae."entityType" = 'maintenance_ticket'
      AND ae.action = 'ticket.sla_breach'
      AND ae."entityId" = mt.id
  `;

  const overdue = await prisma.$executeRaw`
    UPDATE "AuditEvent" AS ae
    SET "locationId" = ct."locationId"
    FROM "CleaningSession" AS cs
    INNER JOIN "CleaningTask" AS ct ON ct.id = cs."taskId"
    WHERE ae."locationId" IS NULL
      AND ae."entityType" = 'cleaning_session'
      AND ae.action = 'session.overdue_detected'
      AND ae."entityId" = cs.id
  `;

  return {
    slaUpdated: Number(sla),
    overdueUpdated: Number(overdue),
  };
}
