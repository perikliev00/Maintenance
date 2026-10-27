-- Additive: optional clarification + custom-path duplicate identity.
-- Partial unique index prevents two active catalog-option tickets for the same room.
-- If existing active duplicates are present, columns still apply and the unique
-- index is skipped with a NOTICE (no auto-delete). Application-level advisory
-- locks remain the primary concurrency guarantee in all environments.

ALTER TABLE "MaintenanceTicket" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "MaintenanceTicket" ADD COLUMN IF NOT EXISTS "duplicateIdentityKey" TEXT;

CREATE INDEX IF NOT EXISTS "MaintenanceTicket_locationId_duplicateIdentityKey_status_idx"
  ON "MaintenanceTicket"("locationId", "duplicateIdentityKey", "status");

DO $$
DECLARE
  dup_count integer;
  dup_sample text;
BEGIN
  SELECT COUNT(*)::integer, string_agg(fmt, ', ')
  INTO dup_count, dup_sample
  FROM (
    SELECT
      format(
        'location=%s option=%s count=%s',
        "locationId",
        "issueOptionId",
        COUNT(*)
      ) AS fmt
    FROM "MaintenanceTicket"
    WHERE "issueOptionId" IS NOT NULL
      AND "status" IN ('new', 'assigned', 'in_progress', 'waiting')
    GROUP BY "locationId", "issueOptionId"
    HAVING COUNT(*) > 1
    LIMIT 10
  ) d;

  IF COALESCE(dup_count, 0) > 0 THEN
    RAISE NOTICE
      'Skipping MaintenanceTicket_active_option_uniq: % active duplicate group(s). Resolve manually then create the index. Sample: %',
      dup_count,
      COALESCE(dup_sample, '(none)');
  ELSE
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceTicket_active_option_uniq"
        ON "MaintenanceTicket" ("locationId", "issueOptionId")
        WHERE "issueOptionId" IS NOT NULL
          AND "status" IN ('new', 'assigned', 'in_progress', 'waiting')
    $idx$;
  END IF;
END $$;
