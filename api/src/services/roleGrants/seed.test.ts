// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:child_process for this service.
import { spawnSync } from "node:child_process";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module node:path for this service.
import path from "node:path";
// Import module @prisma/client for this service.
import { PrismaClient } from "@prisma/client";
// Import module dotenv for this service.
import dotenv from "dotenv";

// Capture control seed id for use in this scope.
const CONTROL_SEED_ID = "grants.t03.control";
// Capture db name prefix for use in this scope.
const DB_NAME_PREFIX = "maintenance_t03_grants";
// Capture api root for use in this scope.
const API_ROOT = path.resolve(__dirname, "../../..");
// Capture child path for use in this scope.
const CHILD_PATH = path.join(API_ROOT, "tests", "roleGrants.bootstrap.child.ts");

// Prefer api/.env over a stale shell DATABASE_URL (dotenv default does not override).
dotenv.config({ path: path.join(API_ROOT, ".env"), override: true });

// Define requireDatabaseUrl — core behavior for this module.
function requireDatabaseUrl(): string {
  // Capture url for use in this scope.
  const url = process.env.DATABASE_URL;
  // Run next step: assert.ok(url, "DATABASE_URL is required for grant bootstrap…
  assert.ok(url, "DATABASE_URL is required for grant bootstrap isolation tests");
  // Return the computed result to the caller.
  return url;
}

// Define withDatabaseName — core behavior for this module.
function withDatabaseName(databaseUrl: string, dbName: string): string {
  // Capture u for use in this scope.
  const u = new URL(databaseUrl);
  // Run next step: u.pathname = `/${dbName}`;
  u.pathname = `/${dbName}`;
  // Return the computed result to the caller.
  return u.toString();
}

// Define assertSafeDbName — core behavior for this module.
function assertSafeDbName(dbName: string): void {
  // Run next step: assert.match(dbName, /^[a-zA-Z0-9_]+$/, `unsafe db name: ${d…
  assert.match(dbName, /^[a-zA-Z0-9_]+$/, `unsafe db name: ${dbName}`);
}

// Define recreateEphemeralDb — core behavior for this module.
async function recreateEphemeralDb(adminUrl: string, dbName: string): Promise<void> {
  // Run next step: assertSafeDbName(dbName);
  assertSafeDbName(dbName);
  // Capture prisma for use in this scope.
  const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  // Attempt the fallible work so errors can be handled below.
  try {
    // Wait for the async step before continuing.
    await prisma.$executeRawUnsafe(
      // Run next step: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHER…
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    // Wait for the async step before continuing.
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    // Wait for the async step before continuing.
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  // Run next step: } finally {
  } finally {
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  }
}

// Define dropEphemeralDb — core behavior for this module.
async function dropEphemeralDb(adminUrl: string, dbName: string): Promise<void> {
  // Run next step: assertSafeDbName(dbName);
  assertSafeDbName(dbName);
  // Capture prisma for use in this scope.
  const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  // Attempt the fallible work so errors can be handled below.
  try {
    // Wait for the async step before continuing.
    await prisma.$executeRawUnsafe(
      // Run next step: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHER…
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    // Wait for the async step before continuing.
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  // Run next step: } finally {
  } finally {
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  }
}

// Define migrateDeploy — core behavior for this module.
function migrateDeploy(databaseUrl: string): void {
  // Capture result for use in this scope.
  const result = spawnSync(
    // Run next step: process.execPath,
    process.execPath,
    // Run next step: [path.join(API_ROOT, "node_modules", "prisma", "build", "ind…
    [path.join(API_ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    // Run next step: {
    {
      // Set cwd on the structure being built.
      cwd: API_ROOT,
      // Set env on the structure being built.
      env: { ...process.env, DATABASE_URL: databaseUrl },
      // Set encoding on the structure being built.
      encoding: "utf8",
    },
  );
  // Branch when this condition holds so the right path runs.
  if (result.status !== 0) {
    // Abort with an error so callers can react.
    throw new Error(
      // Run next step: `prisma migrate deploy failed (exit ${String(result.status)}…
      `prisma migrate deploy failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

// Define runChild — core behavior for this module.
function runChild(databaseUrl: string, scenario: "bootstrap" | "restart"): void {
  // Capture result for use in this scope.
  const result = spawnSync(
    // Run next step: process.execPath,
    process.execPath,
    // Run next step: ["--import", "tsx", CHILD_PATH],
    ["--import", "tsx", CHILD_PATH],
    // Run next step: {
    {
      // Set cwd on the structure being built.
      cwd: API_ROOT,
      // Set env on the structure being built.
      env: {
        // Run next step: ...process.env,
        ...process.env,
        // Set DATABASE_URL on the structure being built.
        DATABASE_URL: databaseUrl,
        // Set T03_SCENARIO on the structure being built.
        T03_SCENARIO: scenario,
      },
      // Set encoding on the structure being built.
      encoding: "utf8",
    },
  );
  // Branch when this condition holds so the right path runs.
  if (result.status !== 0) {
    // Abort with an error so callers can react.
    throw new Error(
      // Run next step: `grant child ${scenario} failed (exit ${String(result.status…
      `grant child ${scenario} failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

// Define insertControl — core behavior for this module.
async function insertControl(databaseUrl: string): Promise<void> {
  // Capture prisma for use in this scope.
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  // Attempt the fallible work so errors can be handled below.
  try {
    // Wait for the async step before continuing.
    await prisma.appliedDataSeed.create({
      // Set data on the structure being built.
      data: { id: CONTROL_SEED_ID },
    });
  // Run next step: } finally {
  } finally {
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  }
}

// Define assertControl — core behavior for this module.
async function assertControl(databaseUrl: string): Promise<void> {
  // Capture prisma for use in this scope.
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  // Attempt the fallible work so errors can be handled below.
  try {
    // Load row asynchronously for the next steps.
    const row = await prisma.appliedDataSeed.findUnique({
      // Set where on the structure being built.
      where: { id: CONTROL_SEED_ID },
    });
    // Run next step: assert.ok(row, "unrelated control AppliedDataSeed must remai…
    assert.ok(row, "unrelated control AppliedDataSeed must remain");
  // Run next step: } finally {
  } finally {
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  }
}

// Run next step: describe("ensureDefaultRoleGrants / applyCatalogGrantSeed (r…
describe("ensureDefaultRoleGrants / applyCatalogGrantSeed (real DB)", () => {
  // Run next step: it("bootstraps on ephemeral DB, keeps revokes across restart…
  it("bootstraps on ephemeral DB, keeps revokes across restart, preserves control", async () => {
    // Capture base url for use in this scope.
    const baseUrl = requireDatabaseUrl();
    // Capture db name for use in this scope.
    const dbName = `${DB_NAME_PREFIX}_${process.pid}_${Date.now()}`;
    // Capture eph url for use in this scope.
    const ephUrl = withDatabaseName(baseUrl, dbName);

    // Wait for the async step before continuing.
    await recreateEphemeralDb(baseUrl, dbName);
    // Attempt the fallible work so errors can be handled below.
    try {
      // Run next step: migrateDeploy(ephUrl);
      migrateDeploy(ephUrl);
      // Wait for the async step before continuing.
      await insertControl(ephUrl);

      // Run next step: runChild(ephUrl, "bootstrap");
      runChild(ephUrl, "bootstrap");
      // Run next step: runChild(ephUrl, "restart");
      runChild(ephUrl, "restart");
      // Wait for the async step before continuing.
      await assertControl(ephUrl);

      // Run next step: runChild(ephUrl, "restart");
      runChild(ephUrl, "restart");
      // Wait for the async step before continuing.
      await assertControl(ephUrl);
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await dropEphemeralDb(baseUrl, dbName);
    }
  });
});
