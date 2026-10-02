-- AlterTable CleaningTask: snapshot of sector supervisor at work time
ALTER TABLE "CleaningTask" ADD COLUMN "sectorSupervisorEmployeeId" TEXT;

CREATE INDEX "CleaningTask_sectorSupervisorEmployeeId_idx" ON "CleaningTask"("sectorSupervisorEmployeeId");

ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_sectorSupervisorEmployeeId_fkey"
  FOREIGN KEY ("sectorSupervisorEmployeeId") REFERENCES "Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill supervisor from current sector primary supervisor when sectorId is set
UPDATE "CleaningTask" AS t
SET "sectorSupervisorEmployeeId" = s."primarySupervisorEmployeeId"
FROM "Sector" AS s
WHERE s."id" = t."sectorId"
  AND t."sectorSupervisorEmployeeId" IS NULL
  AND s."primarySupervisorEmployeeId" IS NOT NULL;

-- AlterTable Location: stable QR token
ALTER TABLE "Location" ADD COLUMN "qrToken" TEXT;

UPDATE "Location"
SET "qrToken" = md5("id" || random()::text || clock_timestamp()::text)
WHERE "qrToken" IS NULL;

ALTER TABLE "Location" ALTER COLUMN "qrToken" SET NOT NULL;

CREATE UNIQUE INDEX "Location_qrToken_key" ON "Location"("qrToken");
