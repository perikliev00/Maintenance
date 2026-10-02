-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'assigned';
ALTER TYPE "TicketStatus" ADD VALUE 'waiting';

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "hours" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlaPolicy_priority_key" ON "SlaPolicy"("priority");

-- AlterTable
ALTER TABLE "MaintenanceTicket" ADD COLUMN "slaPolicyId" TEXT,
ADD COLUMN "slaHoursSnapshot" INTEGER,
ADD COLUMN "slaPausedAt" TIMESTAMP(3),
ADD COLUMN "slaPausedMsTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closedByEmployeeId" TEXT;

CREATE INDEX "MaintenanceTicket_assigneeId_status_idx" ON "MaintenanceTicket"("assigneeId", "status");

ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_closedByEmployeeId_fkey" FOREIGN KEY ("closedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "actorEmployeeId" TEXT NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketEvent_ticketId_occurredAt_idx" ON "TicketEvent"("ticketId", "occurredAt");
CREATE INDEX "TicketEvent_occurredAt_idx" ON "TicketEvent"("occurredAt");

ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
