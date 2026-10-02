-- AlterEnum
ALTER TYPE "DailyPlanSource" ADD VALUE 'import';

-- CreateEnum
CREATE TYPE "DailyPlanImportStatus" AS ENUM ('completed', 'partial', 'failed');

-- CreateTable
CREATE TABLE "DailyPlanImportBatch" (
    "id" TEXT NOT NULL,
    "hotelDate" DATE NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "status" "DailyPlanImportStatus" NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdByEmployeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyPlanImportBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "DailyPlanEntry" ADD COLUMN "externalId" TEXT,
ADD COLUMN "importBatchId" TEXT;

-- CreateIndex
CREATE INDEX "DailyPlanImportBatch_hotelDate_createdAt_idx" ON "DailyPlanImportBatch"("hotelDate", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanEntry_source_externalId_key" ON "DailyPlanEntry"("source", "externalId");

-- CreateIndex
CREATE INDEX "DailyPlanEntry_importBatchId_idx" ON "DailyPlanEntry"("importBatchId");

-- AddForeignKey
ALTER TABLE "DailyPlanImportBatch" ADD CONSTRAINT "DailyPlanImportBatch_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanEntry" ADD CONSTRAINT "DailyPlanEntry_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "DailyPlanImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
