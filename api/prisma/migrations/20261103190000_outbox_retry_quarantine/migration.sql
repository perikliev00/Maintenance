-- Retry / quarantine columns for notification outbox fairness (CODE-06).
-- Existing undelivered rows remain eligible (attemptCount=0, nextAttemptAt NULL).

ALTER TABLE "CleaningNotificationOutbox"
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedPermanentlyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

ALTER TABLE "AttendanceNotificationOutbox"
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedPermanentlyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

ALTER TABLE "TicketNotificationOutbox"
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedPermanentlyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

CREATE INDEX IF NOT EXISTS "CleaningNotificationOutbox_eligible_idx"
  ON "CleaningNotificationOutbox" ("deliveredAt", "failedPermanentlyAt", "nextAttemptAt", "createdAt");

CREATE INDEX IF NOT EXISTS "AttendanceNotificationOutbox_eligible_idx"
  ON "AttendanceNotificationOutbox" ("deliveredAt", "failedPermanentlyAt", "nextAttemptAt", "createdAt");

CREATE INDEX IF NOT EXISTS "TicketNotificationOutbox_eligible_idx"
  ON "TicketNotificationOutbox" ("deliveredAt", "failedPermanentlyAt", "nextAttemptAt", "createdAt");
