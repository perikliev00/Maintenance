-- Access-state revision for optimistic concurrency on people lifecycle.
ALTER TABLE "Employee" ADD COLUMN "accessVersion" INTEGER NOT NULL DEFAULT 0;
