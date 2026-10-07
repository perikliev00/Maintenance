-- Cleaning cycle: only the current generation may change Location.cleaningStatus.
ALTER TABLE "Location" ADD COLUMN "cleaningCycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CleaningTask" ADD COLUMN "cleaningCycle" INTEGER NOT NULL DEFAULT 0;
