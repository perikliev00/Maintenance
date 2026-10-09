-- Idempotent maintenance lifecycle commands (start/wait/resume/resolve).
ALTER TABLE "TicketEvent" ADD COLUMN "commandId" TEXT;

CREATE UNIQUE INDEX "TicketEvent_commandId_key" ON "TicketEvent"("commandId");
