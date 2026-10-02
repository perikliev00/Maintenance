-- AlterTable
ALTER TABLE "CleaningSession" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceTicket" ADD COLUMN     "resolutionNotes" TEXT,
ADD COLUMN     "resolvedByEmployeeId" TEXT;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_resolvedByEmployeeId_fkey" FOREIGN KEY ("resolvedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
