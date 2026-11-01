-- Speed ILIKE / contains search on location numbers used by catalog pagination.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Location_number_trgm_idx"
  ON "Location" USING GIN ("number" gin_trgm_ops);
