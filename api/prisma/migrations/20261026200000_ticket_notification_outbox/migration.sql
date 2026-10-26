CREATE TABLE "TicketNotificationOutbox" (
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    CONSTRAINT "TicketNotificationOutbox_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "TicketNotificationOutbox_deliveredAt_createdAt_idx"
    ON "TicketNotificationOutbox"("deliveredAt", "createdAt");

ALTER TABLE "TicketNotificationOutbox" ADD CONSTRAINT "TicketNotificationOutbox_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "TicketEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
