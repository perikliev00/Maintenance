-- CreateEnum
CREATE TYPE "DailyPlanCategory" AS ENUM ('departure', 'arrival', 'priority');

-- CreateEnum
CREATE TYPE "DailyPlanSource" AS ENUM ('manual');

-- CreateTable
CREATE TABLE "DailyPlanEntry" (
    "id" TEXT NOT NULL,
    "hotelDate" DATE NOT NULL,
    "locationId" TEXT NOT NULL,
    "category" "DailyPlanCategory" NOT NULL,
    "notes" TEXT,
    "source" "DailyPlanSource" NOT NULL DEFAULT 'manual',
    "cleaningTaskId" TEXT,
    "createdByEmployeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyPlanEntry_hotelDate_category_idx" ON "DailyPlanEntry"("hotelDate", "category");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanEntry_hotelDate_locationId_category_key" ON "DailyPlanEntry"("hotelDate", "locationId", "category");

-- AddForeignKey
ALTER TABLE "DailyPlanEntry" ADD CONSTRAINT "DailyPlanEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanEntry" ADD CONSTRAINT "DailyPlanEntry_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanEntry" ADD CONSTRAINT "DailyPlanEntry_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
