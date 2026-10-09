-- Preserve assignee/shift on deferred departure plan entries for confirm-time task bind.
ALTER TABLE "DailyPlanEntry" ADD COLUMN "assignedEmployeeId" TEXT;
ALTER TABLE "DailyPlanEntry" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "DailyPlanEntry_assignedEmployeeId_idx" ON "DailyPlanEntry"("assignedEmployeeId");
CREATE INDEX "DailyPlanEntry_shiftId_idx" ON "DailyPlanEntry"("shiftId");

ALTER TABLE "DailyPlanEntry" ADD CONSTRAINT "DailyPlanEntry_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyPlanEntry" ADD CONSTRAINT "DailyPlanEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
