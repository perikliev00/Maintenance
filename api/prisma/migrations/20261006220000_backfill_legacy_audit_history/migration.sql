-- Conditionally backfill legacy permission/settings history into AuditEvent
-- when PermissionChange / SettingChange still exist (partial or pre-drop DBs).
-- Already-migrated databases where those tables were dropped are a no-op;
-- restore lost rows from backup via prisma/scripts/restore_permission_setting_history.sql.

DO $$
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

    DROP TABLE IF EXISTS "PermissionChange";
  END IF;
END $$;

DO $$
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

    DROP TABLE IF EXISTS "SettingChange";
  END IF;
END $$;
