-- Restore permissions/settings change history into AuditEvent from a backup
-- of the legacy PermissionChange / SettingChange tables.
--
-- Prerequisites:
--   1. Restore dumped rows into staging tables with the original schemas, e.g.:
--        CREATE TABLE "PermissionChange_restore" (LIKE ... or match columns below);
--        CREATE TABLE "SettingChange_restore" (...);
--      Or rename restored backup tables to those staging names.
--   2. Run this script against the live DB (AuditEvent must already exist).
--
-- History dropped by 20261002260000_unified_audit_events without a prior copy
-- cannot be invented; only a backup of the legacy tables can recover it.

-- PermissionChange_restore expected columns:
--   id TEXT, role Role, kind GrantKind, key TEXT, granted BOOLEAN,
--   actorEmployeeId TEXT, reason TEXT, createdAt TIMESTAMP(3)

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
FROM "PermissionChange_restore" pc
ON CONFLICT ("id") DO NOTHING;

-- SettingChange_restore expected columns:
--   id TEXT, key TEXT, before JSONB, after JSONB NOT NULL,
--   actorEmployeeId TEXT, reason TEXT, createdAt TIMESTAMP(3)

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
FROM "SettingChange_restore" sc
ON CONFLICT ("id") DO NOTHING;
