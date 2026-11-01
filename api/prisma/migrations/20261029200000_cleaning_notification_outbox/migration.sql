-- Durable inspection notices for cleaning session complete (replay / flush).
CREATE TABLE "CleaningNotificationOutbox" (
    "commandId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "CleaningNotificationOutbox_pkey" PRIMARY KEY ("commandId")
);

CREATE INDEX "CleaningNotificationOutbox_deliveredAt_createdAt_idx"
    ON "CleaningNotificationOutbox"("deliveredAt", "createdAt");
