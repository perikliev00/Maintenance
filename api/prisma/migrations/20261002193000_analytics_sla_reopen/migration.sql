-- AlterTable
ALTER TABLE "MaintenanceTicket" ADD COLUMN "dueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MaintenanceTicket_openedAt_idx" ON "MaintenanceTicket"("openedAt");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_dueAt_idx" ON "MaintenanceTicket"("dueAt");

-- CreateTable
CREATE TABLE "TicketReopenEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "reopenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedByEmployeeId" TEXT NOT NULL,
    "reason" TEXT,
    "previousStatus" "TicketStatus" NOT NULL,

    CONSTRAINT "TicketReopenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketReopenEvent_ticketId_reopenedAt_idx" ON "TicketReopenEvent"("ticketId", "reopenedAt");

-- CreateIndex
CREATE INDEX "TicketReopenEvent_reopenedAt_idx" ON "TicketReopenEvent"("reopenedAt");

-- AddForeignKey
ALTER TABLE "TicketReopenEvent" ADD CONSTRAINT "TicketReopenEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReopenEvent" ADD CONSTRAINT "TicketReopenEvent_reopenedByEmployeeId_fkey" FOREIGN KEY ("reopenedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
