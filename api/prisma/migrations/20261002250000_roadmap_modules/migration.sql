-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CleaningSession" ADD COLUMN IF NOT EXISTS "anomalyFlags" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorEmployeeId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "locationId" TEXT,
    "summary" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncRun" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "conflicts" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_actorEmployeeId_occurredAt_idx" ON "AuditEvent"("actorEmployeeId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_locationId_occurredAt_idx" ON "AuditEvent"("locationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_action_occurredAt_idx" ON "AuditEvent"("action", "occurredAt");
CREATE INDEX IF NOT EXISTS "JobRun_jobKey_startedAt_idx" ON "JobRun"("jobKey", "startedAt");
CREATE INDEX IF NOT EXISTS "JobRun_startedAt_idx" ON "JobRun"("startedAt");
CREATE INDEX IF NOT EXISTS "SyncRun_userId_startedAt_idx" ON "SyncRun"("userId", "startedAt");
CREATE INDEX IF NOT EXISTS "SyncRun_deviceId_startedAt_idx" ON "SyncRun"("deviceId", "startedAt");
CREATE INDEX IF NOT EXISTS "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
