import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

const CONTROL_SEED_ID = "grants.t03.control";
const DB_NAME_PREFIX = "maintenance_t03_grants";
const API_ROOT = path.resolve(__dirname, "../../..");
const CHILD_PATH = path.join(API_ROOT, "tests", "roleGrants.bootstrap.child.ts");

// Prefer api/.env over a stale shell DATABASE_URL (dotenv default does not override).
dotenv.config({ path: path.join(API_ROOT, ".env"), override: true });

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  assert.ok(url, "DATABASE_URL is required for grant bootstrap isolation tests");
  return url;
}

function withDatabaseName(databaseUrl: string, dbName: string): string {
  const u = new URL(databaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function assertSafeDbName(dbName: string): void {
  assert.match(dbName, /^[a-zA-Z0-9_]+$/, `unsafe db name: ${dbName}`);
}

async function recreateEphemeralDb(adminUrl: string, dbName: string): Promise<void> {
  assertSafeDbName(dbName);
  const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await prisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await prisma.$disconnect();
  }
}

async function dropEphemeralDb(adminUrl: string, dbName: string): Promise<void> {
  assertSafeDbName(dbName);
  const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await prisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await prisma.$disconnect();
  }
}

function migrateDeploy(databaseUrl: string): void {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "migrate", "deploy"],
    {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runChild(databaseUrl: string, scenario: "bootstrap" | "restart"): void {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", CHILD_PATH],
    {
      cwd: API_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        T03_SCENARIO: scenario,
      },
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `grant child ${scenario} failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

async function insertControl(databaseUrl: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.appliedDataSeed.create({
      data: { id: CONTROL_SEED_ID },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function assertControl(databaseUrl: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const row = await prisma.appliedDataSeed.findUnique({
      where: { id: CONTROL_SEED_ID },
    });
    assert.ok(row, "unrelated control AppliedDataSeed must remain");
  } finally {
    await prisma.$disconnect();
  }
}

describe("ensureDefaultRoleGrants / applyCatalogGrantSeed (real DB)", () => {
  it("bootstraps on ephemeral DB, keeps revokes across restart, preserves control", async () => {
    const baseUrl = requireDatabaseUrl();
    const dbName = `${DB_NAME_PREFIX}_${process.pid}_${Date.now()}`;
    const ephUrl = withDatabaseName(baseUrl, dbName);

    await recreateEphemeralDb(baseUrl, dbName);
    try {
      migrateDeploy(ephUrl);
      await insertControl(ephUrl);

      runChild(ephUrl, "bootstrap");
      runChild(ephUrl, "restart");
      await assertControl(ephUrl);

      runChild(ephUrl, "restart");
      await assertControl(ephUrl);
    } finally {
      await dropEphemeralDb(baseUrl, dbName);
    }
  });
});
