/**
 * Upgrade smoke: apply migrations up to (but not including)
 * 20261002260000_unified_audit_events, insert PermissionChange / SettingChange,
 * then migrate deploy the rest and assert rows land in AuditEvent without duplicates.
 *
 * Requires empty DATABASE_URL (dedicated DB). Does not need seed or HTTP API.
 * Run from the api/ working directory.
 */
import "dotenv/config";
import { createHash, randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CUTOFF = "20261002260000_unified_audit_events";
const API_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(API_ROOT, "prisma", "migrations");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => d.name)
    .sort();
}

function checksumFor(migrationName: string): string {
  const sqlPath = path.join(MIGRATIONS_DIR, migrationName, "migration.sql");
  return createHash("sha256").update(readFileSync(sqlPath)).digest("hex");
}

function prismaBin(): string {
  return path.join(
    API_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
}

function dbExecute(sqlPath: string): void {
  execFileSync(
    prismaBin(),
    ["db", "execute", "--file", sqlPath, "--schema", "prisma/schema.prisma"],
    {
      cwd: API_ROOT,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    },
  );
}

function migrateDeploy(): void {
  execFileSync(prismaBin(), ["migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: API_ROOT,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
}

async function ensureMigrationsTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `;
}

async function recordMigration(migrationName: string): Promise<void> {
  const id = randomUUID();
  const checksum = checksumFor(migrationName);
  await prisma.$executeRaw`
    INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
    VALUES (${id}, ${checksum}, now(), ${migrationName}, now(), 1)
  `;
}

async function applyUntilCutoff(): Promise<void> {
  await ensureMigrationsTable();
  const names = migrationNames().filter((n) => n < CUTOFF);
  assert(names.length > 0, "expected migrations before cutoff");
  assert(
    names.includes("20261002250000_roadmap_modules"),
    "expected AuditEvent migration before cutoff",
  );

  for (const name of names) {
    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    console.log(`apply ${name}`);
    dbExecute(sqlPath);
    await recordMigration(name);
  }
}

async function seedLegacyRows(): Promise<{
  permGrantId: string;
  permRevokeId: string;
  settingId: string;
  actorId: string;
  occurredAt: Date;
}> {
  const actorId = "emp_legacy_audit_actor";
  const occurredAt = new Date("2026-09-15T10:30:00.000Z");
  const permGrantId = "pc_legacy_grant_1";
  const permRevokeId = "pc_legacy_revoke_1";
  const settingId = "sc_legacy_setting_1";

  await prisma.$executeRaw`
    INSERT INTO "Employee" ("id", "employeeNumber", "fullName", "createdAt")
    VALUES (${actorId}, ${"LEGACY-AUDIT-1"}, ${"Legacy Audit Actor"}, ${occurredAt})
    ON CONFLICT ("id") DO NOTHING
  `;

  await prisma.$executeRaw`
    INSERT INTO "PermissionChange"
      ("id", "role", "kind", "key", "granted", "actorEmployeeId", "reason", "createdAt")
    VALUES (
      ${permGrantId},
      'manager'::"Role",
      'panel'::"GrantKind",
      ${"audit"},
      ${true},
      ${actorId},
      ${"grant reason"},
      ${occurredAt}
    )
  `;

  await prisma.$executeRaw`
    INSERT INTO "PermissionChange"
      ("id", "role", "kind", "key", "granted", "actorEmployeeId", "reason", "createdAt")
    VALUES (
      ${permRevokeId},
      'technician'::"Role",
      'action'::"GrantKind",
      ${"ticket.assign"},
      ${false},
      ${actorId},
      ${"revoke reason"},
      ${occurredAt}
    )
  `;

  const beforeJson = JSON.stringify("UTC");
  const afterJson = JSON.stringify("Europe/Sofia");
  await prisma.$executeRaw`
    INSERT INTO "SettingChange"
      ("id", "key", "before", "after", "actorEmployeeId", "reason", "createdAt")
    VALUES (
      ${settingId},
      ${"operations.hotelTimezone"},
      ${beforeJson}::jsonb,
      ${afterJson}::jsonb,
      ${actorId},
      ${"tz change"},
      ${occurredAt}
    )
  `;

  return { permGrantId, permRevokeId, settingId, actorId, occurredAt };
}

async function assertLegacyTablesGone(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ reg: string | null }>>`
    SELECT to_regclass('"PermissionChange"')::text AS reg
    UNION ALL
    SELECT to_regclass('"SettingChange"')::text AS reg
  `;
  for (const row of rows) {
    assert(row.reg == null, `legacy table still present: ${row.reg}`);
  }
}

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL required");

  const existing = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Employee'
  `;
  assert(existing[0]?.n === 0, "database must be empty (no Employee table yet)");

  await applyUntilCutoff();
  const seeded = await seedLegacyRows();

  console.log("migrate deploy (remainder)...");
  migrateDeploy();

  const events = await prisma.auditEvent.findMany({
    where: {
      id: { in: [seeded.permGrantId, seeded.permRevokeId, seeded.settingId] },
    },
    orderBy: { id: "asc" },
  });
  assert(events.length === 3, `expected 3 AuditEvent rows, got ${events.length}`);

  const byId = new Map(events.map((e) => [e.id, e]));

  const grant = byId.get(seeded.permGrantId);
  assert(grant, "missing permission.grant event");
  assert(grant.action === "permission.grant", `grant action=${grant.action}`);
  assert(grant.entityType === "role_grant", `grant entityType=${grant.entityType}`);
  assert(grant.entityId === "manager:panel:audit", `grant entityId=${grant.entityId}`);
  assert(grant.actorEmployeeId === seeded.actorId, "grant actor mismatch");
  assert(grant.reason === "grant reason", "grant reason mismatch");
  assert(
    grant.occurredAt.toISOString() === seeded.occurredAt.toISOString(),
    "grant occurredAt mismatch",
  );
  assert(grant.summary === "Granted panel audit for manager", `grant summary=${grant.summary}`);

  const revoke = byId.get(seeded.permRevokeId);
  assert(revoke, "missing permission.revoke event");
  assert(revoke.action === "permission.revoke", `revoke action=${revoke.action}`);
  assert(revoke.entityId === "technician:action:ticket.assign", `revoke entityId=${revoke.entityId}`);
  assert(revoke.actorEmployeeId === seeded.actorId, "revoke actor mismatch");
  assert(
    revoke.summary === "Revoked action ticket.assign for technician",
    `revoke summary=${revoke.summary}`,
  );

  const setting = byId.get(seeded.settingId);
  assert(setting, "missing setting.update event");
  assert(setting.action === "setting.update", `setting action=${setting.action}`);
  assert(setting.entityType === "setting", `setting entityType=${setting.entityType}`);
  assert(setting.entityId === "operations.hotelTimezone", `setting entityId=${setting.entityId}`);
  assert(setting.actorEmployeeId === seeded.actorId, "setting actor mismatch");
  assert(setting.reason === "tz change", "setting reason mismatch");
  assert(
    setting.summary === "Updated setting operations.hotelTimezone",
    `setting summary=${setting.summary}`,
  );
  assert(
    JSON.stringify(setting.before) === JSON.stringify("UTC"),
    `setting before=${JSON.stringify(setting.before)}`,
  );
  assert(
    JSON.stringify(setting.after) === JSON.stringify("Europe/Sofia"),
    `setting after=${JSON.stringify(setting.after)}`,
  );

  const dupCount = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "AuditEvent"
    WHERE "id" IN (${seeded.permGrantId}, ${seeded.permRevokeId}, ${seeded.settingId})
  `;
  assert(dupCount[0]?.n === 3, "duplicate AuditEvent ids detected");

  await assertLegacyTablesGone();
  console.log("smoke-legacy-audit-upgrade: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
