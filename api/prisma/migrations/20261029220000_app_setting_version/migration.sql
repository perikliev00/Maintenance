-- Optimistic concurrency token for AppSetting updates (CAS on PATCH).
ALTER TABLE "AppSetting" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
