#!/usr/bin/env node
/**
 * Cross-platform P1 DB prepare (Node). Used by `ci:local` without a host `psql`.
 * Mirrors scripts/ci/prepare-p1-test-db.sh for create/migrate/seed/.env.p1_test.
 *
 * Usage (repo root):
 *   node scripts/ci/prepare-p1-test-db.mjs --seed=npm --web-origin=http://127.0.0.1:5173
 *   node scripts/ci/prepare-p1-test-db.mjs --seed=register --migrate-plain --web-origin=…
 *   node scripts/ci/prepare-p1-test-db.mjs --env-only --web-origin=…
 *   node scripts/ci/prepare-p1-test-db.mjs --recreate-empty=maintenance_audit_upgrade_smoke
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = path.join(rootDir, process.env.API_DIR || "api");

const DB_NAME = "maintenance_p1_test";
const PGHOST = process.env.PGHOST || "127.0.0.1";
const PGPORT = process.env.PGPORT || "5433";
const PGUSER = process.env.PGUSER || "maintenance";
const PGPASSWORD = process.env.PGPASSWORD || "";
const CONNECTION_LIMIT = process.env.CONNECTION_LIMIT || "10";
const DOCKER_DB_SERVICE = process.env.CI_DOCKER_DB_SERVICE || "db";

let seed = "none";
let webOrigin = "";
let migratePlain = false;
let envOnly = false;
let recreateEmpty = "";

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--seed=")) seed = arg.slice("--seed=".length);
  else if (arg.startsWith("--web-origin=")) webOrigin = arg.slice("--web-origin=".length);
  else if (arg.startsWith("--recreate-empty=")) recreateEmpty = arg.slice("--recreate-empty=".length);
  else if (arg === "--migrate-plain") migratePlain = true;
  else if (arg === "--env-only") envOnly = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(
      "Usage: node scripts/ci/prepare-p1-test-db.mjs [--seed=none|npm|register] [--web-origin=URL] [--migrate-plain] [--env-only] [--recreate-empty=NAME]",
    );
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!PGPASSWORD) {
  console.error("PGPASSWORD is required");
  process.exit(1);
}

const DATABASE_URL_PLAIN = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}?schema=public`;
const DATABASE_URL_LIMITED = `${DATABASE_URL_PLAIN}&connection_limit=${CONNECTION_LIMIT}`;

function dockerDbContainer() {
  const ps = spawnSync("docker", ["compose", "ps", "-q", DOCKER_DB_SERVICE], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (ps.status !== 0) return null;
  return (ps.stdout || "").trim().split(/\r?\n/).find(Boolean) || null;
}

function dockerPsql(sql, database = "postgres") {
  const container = dockerDbContainer();
  if (!container) {
    console.error("docker compose db container not found; start with: docker compose up -d db");
    process.exit(1);
  }
  return spawnSync(
    "docker",
    [
      "exec",
      "-e",
      `PGPASSWORD=${PGPASSWORD}`,
      "-i",
      container,
      "psql",
      "-U",
      PGUSER,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: rootDir, encoding: "utf8" },
  );
}

function runShell(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd || rootDir,
    env: { ...process.env, ...opts.env },
    stdio: "inherit",
    shell: opts.shell ?? true,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

function writeEnv() {
  const lines = [
    `DATABASE_URL="${DATABASE_URL_LIMITED}"`,
    `EXPECTED_TEST_DATABASE=${DB_NAME}`,
    "JWT_SECRET=ci-test-secret-at-least-32-chars-long!!",
  ];
  if (webOrigin) lines.push(`WEB_ORIGIN=${webOrigin}`);
  const envPath = path.join(apiDir, ".env.p1_test");
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
  console.log(
    `Wrote ${path.relative(rootDir, envPath)} (DATABASE_URL redacted; EXPECTED_TEST_DATABASE=${DB_NAME})`,
  );
}

function createDatabase() {
  console.log(`Ensuring database ${DB_NAME} exists on ${PGHOST}:${PGPORT} (role ${PGUSER})`);
  const result = dockerPsql(`CREATE DATABASE ${DB_NAME} OWNER ${PGUSER};`);
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    if (/already exists|duplicate_database/i.test(out)) {
      console.log(`Database ${DB_NAME} already exists — continuing`);
      return;
    }
    console.error(out);
    process.exit(result.status ?? 1);
  }
}

function migrate(url) {
  console.log(`Migrating ${DB_NAME}`);
  runShell("npx", ["prisma", "migrate", "deploy"], {
    cwd: apiDir,
    env: { DATABASE_URL: url },
  });
}

function seedDb(url) {
  if (seed === "none") {
    console.log(`Skipping demo seed for ${DB_NAME}`);
    return;
  }
  if (seed === "npm") {
    console.log(`Seeding ${DB_NAME} via npm run db:seed`);
    runShell("npm", ["run", "db:seed"], {
      cwd: apiDir,
      env: {
        DATABASE_URL: url,
        DEMO_SEED_DATABASE_NAME: DB_NAME,
        ALLOW_DEMO_SEED: "true",
      },
    });
    return;
  }
  if (seed === "register") {
    console.log(`Seeding ${DB_NAME} via registerP1TestEnv.mjs`);
    const result = spawnSync(
      process.execPath,
      ["--import", "./tests/registerP1TestEnv.mjs", "--import", "tsx", "prisma/seed.ts"],
      {
        cwd: apiDir,
        env: {
          ...process.env,
          DATABASE_URL: url,
          DEMO_SEED_DATABASE_NAME: DB_NAME,
          ALLOW_DEMO_SEED: "true",
        },
        stdio: "inherit",
      },
    );
    if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
    return;
  }
  console.error(`Invalid --seed=${seed}`);
  process.exit(2);
}

function recreateEmptyDatabase(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    console.error(`Refusing unsafe database name: ${name}`);
    process.exit(1);
  }
  console.log(`Recreating empty database ${name} on ${PGHOST}:${PGPORT}`);
  // DROP/CREATE DATABASE cannot run inside a multi-statement transaction.
  const steps = [
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`,
    `DROP DATABASE IF EXISTS ${name};`,
    `CREATE DATABASE ${name} OWNER ${PGUSER};`,
  ];
  for (const sql of steps) {
    const result = dockerPsql(sql);
    if (result.status !== 0) {
      console.error(`${result.stdout || ""}${result.stderr || ""}`);
      process.exit(result.status ?? 1);
    }
  }
  const url = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${name}?schema=public`;
  // Print only the URL to stdout last line for callers; password is expected locally.
  console.log(`EMPTY_DATABASE_URL=${url}`);
}

if (recreateEmpty) {
  recreateEmptyDatabase(recreateEmpty);
  process.exit(0);
}

if (envOnly) {
  writeEnv();
  process.exit(0);
}

createDatabase();
const migrateUrl = migratePlain ? DATABASE_URL_PLAIN : DATABASE_URL_LIMITED;
if (seed === "register") {
  writeEnv();
  migrate(migrateUrl);
  seedDb(DATABASE_URL_PLAIN);
} else {
  migrate(migrateUrl);
  seedDb(DATABASE_URL_LIMITED);
  writeEnv();
}
