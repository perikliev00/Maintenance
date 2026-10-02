-- AlterTable (idempotent: columns may already exist from a partial apply)
DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD COLUMN "locationId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD COLUMN "summary" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- DropIndex
DROP INDEX IF EXISTS "AuditEvent_entityType_entityId_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_locationId_occurredAt_idx" ON "AuditEvent"("locationId", "occurredAt");

-- DropTable
DROP TABLE IF EXISTS "PermissionChange";
DROP TABLE IF EXISTS "SettingChange";
