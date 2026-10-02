-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('climate', 'electrical', 'furniture', 'plumbing', 'other');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('new', 'in_progress', 'resolved', 'closed');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'awaiting_inspection';

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "reassignReason" TEXT;

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "inspectorEmployeeId" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "result" "InspectionResult" NOT NULL,
    "findings" TEXT,
    "commandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTicket" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "blocksRoom" BOOLEAN NOT NULL DEFAULT false,
    "status" "TicketStatus" NOT NULL DEFAULT 'new',
    "reportedByEmployeeId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "commandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_commandId_key" ON "Inspection"("commandId");

-- CreateIndex
CREATE INDEX "Inspection_taskId_idx" ON "Inspection"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceTicket_commandId_key" ON "MaintenanceTicket"("commandId");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_locationId_status_idx" ON "MaintenanceTicket"("locationId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_blocksRoom_status_idx" ON "MaintenanceTicket"("blocksRoom", "status");

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CleaningTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectorEmployeeId_fkey" FOREIGN KEY ("inspectorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_reportedByEmployeeId_fkey" FOREIGN KEY ("reportedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
