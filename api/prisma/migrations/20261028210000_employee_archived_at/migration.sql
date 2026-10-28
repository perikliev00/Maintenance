-- Soft-archive employees while preserving history and assignment links.
ALTER TABLE "Employee" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Employee_archivedAt_idx" ON "Employee"("archivedAt");
