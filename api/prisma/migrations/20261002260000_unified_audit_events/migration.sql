-- AlterTable (idempotent: columns may already exist from a partial apply)
DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD COLUMN "locationId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD COLUMN "summary" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- DropIndex
DROP INDEX IF EXISTS "AuditEvent_entityType_entityId_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_locationId_occurredAt_idx" ON "AuditEvent"("locationId", "occurredAt");

-- Copy legacy permission/settings history into AuditEvent, verify, then drop.
DO $$
DECLARE
  src_count INTEGER;
  dst_count INTEGER;
BEGIN
  IF to_regclass('"PermissionChange"') IS NOT NULL THEN
    INSERT INTO "AuditEvent" (
      "id",
      "actorEmployeeId",
      "action",
      "entityType",
      "entityId",
      "occurredAt",
      "reason",
      "before",
      "after",
      "summary"
    )
    SELECT
      pc."id",
      pc."actorEmployeeId",
      CASE WHEN pc."granted" THEN 'permission.grant' ELSE 'permission.revoke' END,
      'role_grant',
      pc."role"::text || ':' || pc."kind"::text || ':' || pc."key",
      pc."createdAt",
      pc."reason",
      jsonb_build_object('granted', NOT pc."granted"),
      jsonb_build_object(
        'role', pc."role"::text,
        'kind', pc."kind"::text,
        'key', pc."key",
        'granted', pc."granted"
      ),
      CASE
        WHEN pc."granted" THEN 'Granted '
        ELSE 'Revoked '
      END || pc."kind"::text || ' ' || pc."key" || ' for ' || pc."role"::text
    FROM "PermissionChange" pc
    ON CONFLICT ("id") DO NOTHING;

    SELECT count(*)::int INTO src_count FROM "PermissionChange";
    SELECT count(*)::int INTO dst_count
    FROM "AuditEvent" ae
    WHERE ae."id" IN (SELECT pc."id" FROM "PermissionChange" pc);

    IF src_count <> dst_count THEN
      RAISE EXCEPTION
        'PermissionChange backfill incomplete: source=% AuditEvent=%',
        src_count, dst_count;
    END IF;

    DROP TABLE IF EXISTS "PermissionChange";
  END IF;
END $$;

DO $$
DECLARE
  src_count INTEGER;
  dst_count INTEGER;
BEGIN
  IF to_regclass('"SettingChange"') IS NOT NULL THEN
    INSERT INTO "AuditEvent" (
      "id",
      "actorEmployeeId",
      "action",
      "entityType",
      "entityId",
      "occurredAt",
      "reason",
      "before",
      "after",
      "summary"
    )
    SELECT
      sc."id",
      sc."actorEmployeeId",
      'setting.update',
      'setting',
      sc."key",
      sc."createdAt",
      sc."reason",
      sc."before",
      sc."after",
      'Updated setting ' || sc."key"
    FROM "SettingChange" sc
    ON CONFLICT ("id") DO NOTHING;

    SELECT count(*)::int INTO src_count FROM "SettingChange";
    SELECT count(*)::int INTO dst_count
    FROM "AuditEvent" ae
    WHERE ae."id" IN (SELECT sc."id" FROM "SettingChange" sc);

    IF src_count <> dst_count THEN
      RAISE EXCEPTION
        'SettingChange backfill incomplete: source=% AuditEvent=%',
        src_count, dst_count;
    END IF;

    DROP TABLE IF EXISTS "SettingChange";
  END IF;
END $$;
