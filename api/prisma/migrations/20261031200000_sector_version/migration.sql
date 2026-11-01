-- Optimistic concurrency for sector metadata + membership atomic saves.
ALTER TABLE "Sector" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- Catalog search / sort helpers for paginated location lists.
CREATE INDEX IF NOT EXISTS "Location_number_idx" ON "Location" ("number");
