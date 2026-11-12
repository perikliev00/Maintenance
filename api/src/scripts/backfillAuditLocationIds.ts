/**
 * Backfill historical SLA / overdue audit rows that were written without
 * locationId (pre BUG-01). Safe to re-run; only updates null locationId rows.
 *
 * One-off / ops script — not part of the request path.
 * Run: `npx tsx src/scripts/backfillAuditLocationIds.ts` from api/.
 */
import { prisma } from "../db";

// Export type definition for consumers of this module.
export type AuditLocationBackfillResult = {
  // Provide slaUpdated field used by this structure.
  slaUpdated: number;
  // Provide overdueUpdated field used by this structure.
  overdueUpdated: number;
};

/** Fill null locationId on ticket.sla_breach / session.overdue_detected rows. */
export async function backfillAuditLocationIds(): Promise<AuditLocationBackfillResult> {
  // Bind sla for use in the following logic.
  const sla = await prisma.$executeRaw`
    UPDATE "AuditEvent" AS ae
    SET "locationId" = mt."locationId"
    FROM "MaintenanceTicket" AS mt
    WHERE ae."locationId" IS NULL
      AND ae."entityType" = 'maintenance_ticket'
      AND ae.action = 'ticket.sla_breach'
      AND ae."entityId" = mt.id
  `;

  // Bind overdue for use in the following logic.
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

  // Return early result or rendered output from this path.
  return {
    // Provide slaUpdated field used by this structure.
    slaUpdated: Number(sla),
    // Provide overdueUpdated field used by this structure.
    overdueUpdated: Number(overdue),
  };
}

// Bind isDirectRun for use in the following logic.
const isDirectRun =
  // Support the surrounding logic for this step.
  typeof process.argv[1] === "string" &&
  // Support the surrounding logic for this step.
  /backfillAuditLocationIds\.(ts|js|mjs|cjs)$/.test(process.argv[1].replace(/\\/g, "/"));

// Conditional branch for the case described by this guard.
if (isDirectRun) {
  // Invoke backfillAuditLocationIds to perform this step.
  backfillAuditLocationIds()
    // Continue a chained call building on the previous expression.
    .then((result) => {
      // Emit diagnostic output for debugging this path.
      console.log(JSON.stringify(result));
    })
    // Continue a chained call building on the previous expression.
    .catch((err) => {
      // Emit diagnostic output for debugging this path.
      console.error(err);
      // Support the surrounding logic for this step.
      process.exitCode = 1;
    })
    // Continue a chained call building on the previous expression.
    .finally(async () => {
      // Wait for an async operation before continuing.
      await prisma.$disconnect();
    });
}
