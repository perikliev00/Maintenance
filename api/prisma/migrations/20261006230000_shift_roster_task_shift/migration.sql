-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN "shiftId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeShiftRoster" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hotelDate" DATE NOT NULL,
    "shiftId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeShiftRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleaningTask_hotelDate_shiftId_idx" ON "CleaningTask"("hotelDate", "shiftId");

-- CreateIndex
CREATE INDEX "EmployeeShiftRoster_hotelDate_shiftId_idx" ON "EmployeeShiftRoster"("hotelDate", "shiftId");

-- CreateIndex
CREATE INDEX "EmployeeShiftRoster_shiftId_idx" ON "EmployeeShiftRoster"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeShiftRoster_employeeId_hotelDate_key" ON "EmployeeShiftRoster"("employeeId", "hotelDate");

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeShiftRoster" ADD CONSTRAINT "EmployeeShiftRoster_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeShiftRoster" ADD CONSTRAINT "EmployeeShiftRoster_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
