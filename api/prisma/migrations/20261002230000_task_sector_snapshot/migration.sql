-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN "sectorId" TEXT;

-- CreateIndex
CREATE INDEX "CleaningTask_sectorId_idx" ON "CleaningTask"("sectorId");

-- CreateIndex
CREATE INDEX "CleaningTask_assignedEmployeeId_status_idx" ON "CleaningTask"("assignedEmployeeId", "status");

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill sector snapshot from current room membership
UPDATE "CleaningTask" AS t
SET "sectorId" = sl."sectorId"
FROM "SectorLocation" AS sl
WHERE sl."locationId" = t."locationId" AND t."sectorId" IS NULL;
