-- Durable attendance-adjustment notices (request / review), committed with the
-- adjustment + audit row and delivered after commit or by background flush.
CREATE TABLE "AttendanceNotificationOutbox" (
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceNotificationOutbox_pkey" PRIMARY KEY ("dedupeKey")
);

CREATE INDEX "AttendanceNotificationOutbox_deliveredAt_createdAt_idx"
    ON "AttendanceNotificationOutbox"("deliveredAt", "createdAt");
