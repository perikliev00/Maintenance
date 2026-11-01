-- BUG-01 historical repair: fill null locationId on SLA / overdue audit rows
-- from the live ticket / cleaning task graph. Idempotent.

UPDATE "AuditEvent" AS ae
SET "locationId" = mt."locationId"
FROM "MaintenanceTicket" AS mt
WHERE ae."locationId" IS NULL
  AND ae."entityType" = 'maintenance_ticket'
  AND ae.action = 'ticket.sla_breach'
  AND ae."entityId" = mt.id;

UPDATE "AuditEvent" AS ae
SET "locationId" = ct."locationId"
FROM "CleaningSession" AS cs
INNER JOIN "CleaningTask" AS ct ON ct.id = cs."taskId"
WHERE ae."locationId" IS NULL
  AND ae."entityType" = 'cleaning_session'
  AND ae.action = 'session.overdue_detected'
  AND ae."entityId" = cs.id;
