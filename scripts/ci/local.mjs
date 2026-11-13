#!/usr/bin/env node
/**
 * Local CI gate that mirrors the mandatory checks in `.github/workflows/ci.yml`.
 *
 * Usage (repo root):
 *   npm run ci:local
 *   node ./scripts/ci/local.mjs
 *   node ./scripts/ci/local.mjs --skip-e2e
 *   node ./scripts/ci/local.mjs --skip-containers
 *
 * Exit code is non-zero on any failed/missing check, timeout, or crash.
 * Concurrent runs are refused via an exclusive local lock so they cannot share
 * mutating PostgreSQL state on maintenance_ci_local / maintenance_p1_test.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const apiDir = path.join(rootDir, "api");
const webDir = path.join(rootDir, "web");
const e2eDir = path.join(rootDir, "e2e");

const LOCK_PORT = Number(process.env.CI_LOCAL_LOCK_PORT || 47321);
const LOCK_FILE = path.join(os.tmpdir(), "maintenance-ci-local.lock");

const DEFAULT_PG = {
  host: process.env.PGHOST || "127.0.0.1",
  port: process.env.PGPORT || "5433",
  user: process.env.PGUSER || "maintenance",
  password: process.env.PGPASSWORD || "maintenance",
  // Disposable CI working DB — never the Compose POSTGRES_DB "maintenance" (dev).
  workingDb: process.env.CI_WORKING_DATABASE || "maintenance_ci_local",
  p1Db: "maintenance_p1_test",
  // Compose-created DB used only for readiness probes / CREATE DATABASE.
  adminDb: process.env.CI_ADMIN_DATABASE || "maintenance",
};

const args = new Set(process.argv.slice(2));
const skipE2e = args.has("--skip-e2e");
const skipContainers = args.has("--skip-containers") || args.has("--no-containers");
const skipInstall = args.has("--skip-install");
const help = args.has("-h") || args.has("--help");

if (help) {
  console.log(`Usage: node scripts/ci/local.mjs [--skip-e2e] [--skip-containers] [--skip-install]

Mirrors GitHub CI jobs: API, Web, Smoke, Smoke audit upgrade, E2E.
Container image build/scan, Gitleaks, and OSV are reported as local differences
unless Docker image verification is enabled (default: run compose config +
optional image build when Docker is available; Trivy/Gitleaks/OSV stay GitHub-only).
`);
  process.exit(0);
}

/** @type {{ name: string, status: "pass" | "fail" | "skip", detail?: string }[]} */
const results = [];
let lockServer = null;
let lockFd = null;
let failed = false;

function mark(name, status, detail) {
  results.push({ name, status, detail });
  const tag = status.toUpperCase();
  console.log(`\n==> [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (status === "fail") failed = true;
}

function which(cmd) {
  // `command` is a shell builtin — spawnSync("command", …) is ENOENT on Linux.
  // Windows: where.exe. Unix: /bin/sh -c 'command -v -- "$1"'.
  const res =
    process.platform === "win32"
      ? spawnSync("where.exe", [cmd], { encoding: "utf8" })
      : spawnSync("/bin/sh", ["-c", 'command -v -- "$1"', "which", cmd], {
          encoding: "utf8",
        });
  if (res.error || res.status !== 0) return null;
  const line = (res.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

function run(command, options = {}) {
  const {
    cwd = rootDir,
    env = process.env,
    label = command,
    timeoutMs = 0,
    // Command strings ("npm run lint", "docker compose …") always need a shell.
    // shell:false on Linux treated the whole string as an executable → ENOENT.
    shell = true,
  } = options;
  console.log(`\n$ (${path.relative(rootDir, cwd) || "."}) ${label}`);
  const result = spawnSync(command, {
    cwd,
    env,
    stdio: "inherit",
    shell,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    killSignal: "SIGTERM",
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      console.error(`Command timed out after ${timeoutMs}ms: ${label}`);
      return 124;
    }
    console.error(`Command failed to start: ${label}\n${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`Command killed by signal ${result.signal}: ${label}`);
    return 1;
  }
  return result.status ?? 1;
}

function runNodeNpm(script, cwd, env, label) {
  return run(`npm run ${script}`, { cwd, env, label: label || `npm run ${script}` });
}

function npmCi(cwd, label) {
  return run("npm ci", { cwd, label: label || "npm ci" });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function clearStaleLockFile() {
  if (!fs.existsSync(LOCK_FILE)) return;
  let holder = null;
  try {
    holder = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    fs.unlinkSync(LOCK_FILE);
    return;
  }
  if (holder && pidAlive(holder.pid)) return;
  try {
    fs.unlinkSync(LOCK_FILE);
    console.log(`Removed stale CI lock file (pid ${holder?.pid ?? "unknown"} no longer running)`);
  } catch {
    /* ignore race */
  }
}

function acquireLock() {
  return new Promise((resolve, reject) => {
    clearStaleLockFile();
    try {
      lockFd = fs.openSync(LOCK_FILE, "wx");
      fs.writeFileSync(
        lockFd,
        JSON.stringify(
          {
            pid: process.pid,
            startedAt: new Date().toISOString(),
            cwd: rootDir,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      if (err && err.code === "EEXIST") {
        let holder = "(unknown)";
        try {
          holder = fs.readFileSync(LOCK_FILE, "utf8").trim();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `Another local CI run holds ${LOCK_FILE}. Refusing concurrent PostgreSQL mutation.\n${holder}`,
          ),
        );
        return;
      }
      reject(err);
      return;
    }

    lockServer = net.createServer();
    lockServer.once("error", (err) => {
      cleanupLock();
      if (err && err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Another local CI run is listening on 127.0.0.1:${LOCK_PORT}. Refusing concurrent PostgreSQL mutation.`,
          ),
        );
        return;
      }
      reject(err);
    });
    lockServer.listen(LOCK_PORT, "127.0.0.1", () => resolve());
  });
}

function cleanupLock() {
  if (lockServer) {
    try {
      lockServer.close();
    } catch {
      /* ignore */
    }
    lockServer = null;
  }
  if (lockFd != null) {
    try {
      fs.closeSync(lockFd);
    } catch {
      /* ignore */
    }
    lockFd = null;
  }
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

function workingDatabaseUrl() {
  return `postgresql://${DEFAULT_PG.user}:${DEFAULT_PG.password}@${DEFAULT_PG.host}:${DEFAULT_PG.port}/${DEFAULT_PG.workingDb}?schema=public`;
}

function p1DatabaseUrl(extra = "connection_limit=10") {
  const q = extra ? `?schema=public&${extra}` : "?schema=public";
  return `postgresql://${DEFAULT_PG.user}:${DEFAULT_PG.password}@${DEFAULT_PG.host}:${DEFAULT_PG.port}/${DEFAULT_PG.p1Db}${q}`;
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    CI: process.env.CI || "1",
    PGHOST: DEFAULT_PG.host,
    PGPORT: String(DEFAULT_PG.port),
    PGUSER: DEFAULT_PG.user,
    PGPASSWORD: DEFAULT_PG.password,
    DATABASE_URL: workingDatabaseUrl(),
    JWT_SECRET: process.env.JWT_SECRET || "ci-test-secret-at-least-32-chars-long!!",
    ALLOW_DEMO_SEED: "true",
    DEMO_SEED_DATABASE_NAME: DEFAULT_PG.workingDb,
    EXPECTED_TEST_DATABASE: DEFAULT_PG.p1Db,
    P1_TEST_DATABASE_URL: p1DatabaseUrl(),
    WEB_ORIGIN: process.env.WEB_ORIGIN || "http://127.0.0.1:5173",
    E2E_DISABLE_RATE_LIMIT: "1",
    PORT: process.env.PORT || "4000",
    ...extra,
  };
}

function ensureDockerDb() {
  const docker = which("docker") || which("docker.exe");
  if (!docker) {
    mark("postgres", "fail", "docker not found on PATH");
    return false;
  }
  const ps = spawnSync("docker", ["compose", "ps", "-q", "db"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (ps.status !== 0 || !(ps.stdout || "").trim()) {
    console.log("Starting docker compose db…");
    const up = run("docker compose up -d db", {
      cwd: rootDir,
      label: "docker compose up -d db",
    });
    if (up !== 0) {
      mark("postgres", "fail", "docker compose up -d db failed");
      return false;
    }
  }
  for (let i = 0; i < 30; i++) {
    const ready = spawnSync(
      "docker",
      ["compose", "exec", "-T", "db", "pg_isready", "-U", DEFAULT_PG.user, "-d", DEFAULT_PG.adminDb],
      { cwd: rootDir, encoding: "utf8" },
    );
    if (ready.status === 0) {
      mark("postgres", "pass", `${DEFAULT_PG.host}:${DEFAULT_PG.port}`);
      return true;
    }
    spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)"]);
  }
  mark("postgres", "fail", "pg_isready timed out");
  return false;
}

/** Create the disposable CI working DB if missing (never DROP the Compose admin/dev DB). */
function ensureWorkingDatabase() {
  const name = DEFAULT_PG.workingDb;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    mark("prepare-db", "fail", `unsafe CI_WORKING_DATABASE: ${name}`);
    return false;
  }
  if (name === DEFAULT_PG.adminDb) {
    mark(
      "prepare-db",
      "fail",
      `CI_WORKING_DATABASE must not be the Compose admin/dev database (${DEFAULT_PG.adminDb})`,
    );
    return false;
  }
  console.log(
    `Ensuring CI working database ${name} exists (admin/dev DB ${DEFAULT_PG.adminDb} left untouched)`,
  );
  const ps = spawnSync("docker", ["compose", "ps", "-q", "db"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const container = (ps.stdout || "").trim().split(/\r?\n/).find(Boolean);
  if (!container) {
    mark("prepare-db", "fail", "docker compose db container not found");
    return false;
  }
  const create = spawnSync(
    "docker",
    [
      "exec",
      "-e",
      `PGPASSWORD=${DEFAULT_PG.password}`,
      "-i",
      container,
      "psql",
      "-U",
      DEFAULT_PG.user,
      "-d",
      DEFAULT_PG.adminDb,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `CREATE DATABASE ${name} OWNER ${DEFAULT_PG.user};`,
    ],
    { cwd: rootDir, encoding: "utf8" },
  );
  const out = `${create.stdout || ""}${create.stderr || ""}`;
  if (create.status !== 0 && !/already exists|duplicate_database/i.test(out)) {
    console.error(out);
    mark("prepare-db", "fail", `could not create ${name}`);
    return false;
  }
  return true;
}

function prepareP1(argsList, env) {
  const result = spawnSync(
    process.execPath,
    ["scripts/ci/prepare-p1-test-db.mjs", ...argsList],
    {
      cwd: rootDir,
      env: {
        ...env,
        API_DIR: "api",
        PGPASSWORD: DEFAULT_PG.password,
        PGHOST: DEFAULT_PG.host,
        PGPORT: String(DEFAULT_PG.port),
        PGUSER: DEFAULT_PG.user,
      },
      stdio: "inherit",
    },
  );
  return result.status ?? 1;
}

function prepareDatabases(env) {
  // Working DB migrate + seed (Smoke / smoke scripts). Audit-upgrade uses a
  // dedicated empty DB (GitHub gets a fresh service container).
  // Destructive seed targets maintenance_ci_local only — not Compose "maintenance".
  console.log(`CI destructive seed target DATABASE_URL db=${DEFAULT_PG.workingDb}`);
  if (!ensureWorkingDatabase()) return false;
  const migrateWorking = run("npx prisma migrate deploy", {
    cwd: apiDir,
    env,
    label: "prisma migrate deploy (working DB)",
  });
  if (migrateWorking !== 0) {
    mark("prepare-db", "fail", "working DB migrate failed");
    return false;
  }
  const seedWorking = run("npm run db:seed", {
    cwd: apiDir,
    env: { ...env, DEMO_SEED_DATABASE_NAME: DEFAULT_PG.workingDb },
    label: "db:seed (working DB)",
  });
  if (seedWorking !== 0) {
    mark("prepare-db", "fail", "working DB seed failed");
    return false;
  }

  if (
    prepareP1(
      ["--seed=npm", "--web-origin=http://127.0.0.1:5173"],
      env,
    ) !== 0
  ) {
    mark("prepare-db", "fail", "prepare-p1-test-db.mjs failed");
    return false;
  }
  mark("prepare-db", "pass", `${DEFAULT_PG.workingDb} + ${DEFAULT_PG.p1Db} ready`);
  return true;
}

function collectSuites(suites, cwd, env) {
  let suiteFailed = 0;
  for (const [name, command] of suites) {
    const ec = run(command, { cwd, env, label: name });
    if (ec !== 0) {
      console.error(`suite '${name}' failed with exit ${ec}`);
      suiteFailed = 1;
      mark(name, "fail", `exit ${ec}`);
    } else {
      console.log(`suite '${name}' passed`);
      mark(name, "pass");
    }
  }
  return suiteFailed;
}

function runApiJob(env) {
  let ok = true;
  if (!skipInstall) {
    if (npmCi(apiDir, "api npm ci") !== 0) ok = false;
  }
  if (run("npx prisma generate", { cwd: apiDir, env, label: "prisma generate" }) !== 0) {
    ok = false;
  }
  if (runNodeNpm("lint", apiDir, env, "api lint") !== 0) ok = false;
  if (runNodeNpm("build", apiDir, env, "api build") !== 0) ok = false;
  if (runNodeNpm("typecheck:tests", apiDir, env, "api typecheck:tests") !== 0) {
    ok = false;
  }
  mark("job:API", ok ? "pass" : "fail");
  return ok;
}

function runWebJob(env) {
  let ok = true;
  if (!skipInstall) {
    if (npmCi(webDir, "web npm ci") !== 0) ok = false;
  }
  if (runNodeNpm("lint", webDir, env, "web lint") !== 0) ok = false;
  if (runNodeNpm("build", webDir, env, "web build") !== 0) ok = false;
  if (runNodeNpm("typecheck:tests", webDir, env, "web typecheck:tests") !== 0) {
    ok = false;
  }
  if (runNodeNpm("test", webDir, env, "web unit tests") !== 0) ok = false;
  mark("job:Web", ok ? "pass" : "fail");
  return ok;
}

function runSmokeJob(env) {
  const smokeEnv = {
    ...env,
    EXPECTED_TEST_DATABASE: DEFAULT_PG.p1Db,
    P1_TEST_DATABASE_URL: p1DatabaseUrl(),
  };
  let ok = true;
  if (run("npx tsx scripts/assert-sql-invariants.ts", {
    cwd: apiDir,
    env: smokeEnv,
    label: "assert-sql-invariants",
  }) !== 0) {
    ok = false;
    mark("assert-sql-invariants", "fail");
  } else {
    mark("assert-sql-invariants", "pass");
  }
  if (runNodeNpm("prove:p1-isolation", apiDir, smokeEnv) !== 0) {
    ok = false;
  } else {
    mark("prove:p1-isolation", "pass");
  }
  if (runNodeNpm("test:inventory", apiDir, smokeEnv) !== 0) {
    ok = false;
  } else {
    mark("test:inventory", "pass");
  }

  const apiSuites = [
    ["scenarios", "npm run test:scenarios"],
    ["unit-src", "npm test"],
    ["cleaning", "npm run test:cleaning-lifecycle"],
    ["readiness", "npm run test:readiness"],
    ["tickets", "npm run test:tickets-lifecycle"],
    ["plan", "npm run test:plan"],
    ["sectors", "npm run test:sectors"],
    ["shifts", "npm run test:shifts"],
    ["my-work", "npm run test:my-work"],
    ["attendance", "npm run test:attendance"],
    ["cards", "npm run test:cards"],
    ["people", "npm run test:people"],
    ["auth", "npm run test:auth"],
  ];
  if (collectSuites(apiSuites, apiDir, smokeEnv) !== 0) ok = false;

  // Match CI: re-seed working DB before smoke scripts.
  if (run("npm run db:seed", {
    cwd: apiDir,
    env: { ...smokeEnv, DATABASE_URL: workingDatabaseUrl(), DEMO_SEED_DATABASE_NAME: DEFAULT_PG.workingDb },
    label: "db:seed before smoke scripts",
  }) !== 0) {
    ok = false;
    mark("db:seed-before-smoke", "fail");
  }

  const smokeSuites = [
    ["ticket-lifecycle", "npx tsx scripts/smoke-ticket-lifecycle-idempotency.ts"],
    ["cleaning-atomic", "npx tsx scripts/smoke-cleaning-atomic.ts"],
    ["invitation-atomic", "npx tsx scripts/smoke-invitation-atomic.ts"],
    ["invitation-role", "npx tsx scripts/smoke-invitation-role.ts"],
    ["attendance-isolated", "npm run smoke:attendance:isolated"],
    ["maintenance-atomic", "npx tsx scripts/smoke-maintenance-atomic.ts"],
    ["daily-plan-atomic", "npx tsx scripts/smoke-daily-plan-atomic.ts"],
    ["data-scope", "npx tsx scripts/smoke-data-scope.ts"],
  ];
  // Smoke scripts use the working DATABASE_URL (as in GitHub CI after re-seed).
  const smokeScriptEnv = {
    ...smokeEnv,
    DATABASE_URL: workingDatabaseUrl(),
    DEMO_SEED_DATABASE_NAME: DEFAULT_PG.workingDb,
  };
  if (collectSuites(smokeSuites, apiDir, smokeScriptEnv) !== 0) ok = false;

  mark("job:Smoke", ok ? "pass" : "fail");
  return ok;
}

function runSmokeAuditUpgrade(env) {
  // GitHub job uses a fresh Postgres service (empty `maintenance`). Locally the
  // working DB is seeded, so recreate a dedicated empty database instead.
  const emptyName = "maintenance_audit_upgrade_smoke";
  const prep = spawnSync(
    process.execPath,
    ["scripts/ci/prepare-p1-test-db.mjs", `--recreate-empty=${emptyName}`],
    {
      cwd: rootDir,
      env: {
        ...env,
        PGPASSWORD: DEFAULT_PG.password,
        PGHOST: DEFAULT_PG.host,
        PGPORT: String(DEFAULT_PG.port),
        PGUSER: DEFAULT_PG.user,
      },
      encoding: "utf8",
    },
  );
  if ((prep.status ?? 1) !== 0) {
    if (prep.stdout) process.stdout.write(prep.stdout);
    if (prep.stderr) process.stderr.write(prep.stderr);
    mark("job:Smoke audit upgrade", "fail", "could not recreate empty audit DB");
    return false;
  }
  if (prep.stdout) process.stdout.write(prep.stdout);
  const match = (prep.stdout || "").match(/^EMPTY_DATABASE_URL=(.+)$/m);
  if (!match) {
    mark("job:Smoke audit upgrade", "fail", "missing EMPTY_DATABASE_URL from prepare");
    return false;
  }
  const emptyUrl = match[1].trim();
  const ec = run("npx tsx scripts/smoke-legacy-audit-upgrade.ts", {
    cwd: apiDir,
    env: { ...env, DATABASE_URL: emptyUrl },
    label: "smoke-legacy-audit-upgrade",
  });
  mark("job:Smoke audit upgrade", ec === 0 ? "pass" : "fail", ec === 0 ? undefined : `exit ${ec}`);
  return ec === 0;
}

function runE2eJob(env) {
  if (skipE2e) {
    mark("job:E2E", "skip", "--skip-e2e");
    return true;
  }
  let ok = true;

  if (!skipInstall) {
    if (npmCi(e2eDir, "e2e npm ci") !== 0) ok = false;
  }

  const browsers = run("npx playwright install chromium", {
    cwd: e2eDir,
    env,
    label: "playwright install chromium",
  });
  if (browsers !== 0) ok = false;

  if (
    prepareP1(
      [
        "--seed=register",
        "--web-origin=http://127.0.0.1:5173",
        "--migrate-plain",
      ],
      env,
    ) !== 0
  ) {
    mark("job:E2E", "fail", "P1 prepare for Playwright failed");
    return false;
  }
  if (runNodeNpm("prove:p1-isolation", apiDir, env) !== 0) ok = false;

  const e2eEnv = {
    ...env,
    CI: "1",
    E2E_DISABLE_RATE_LIMIT: "1",
    WEB_ORIGIN: "http://127.0.0.1:5173",
    PORT: "4000",
    P1_TEST_DATABASE_URL: p1DatabaseUrl(""),
  };
  if (run("npm test", { cwd: e2eDir, env: e2eEnv, label: "playwright main suite" }) !== 0) {
    ok = false;
  }

  if (
    prepareP1(["--env-only", "--web-origin=http://127.0.0.1:5185"], env) !== 0
  ) {
    mark("job:E2E", "fail", "P1 env rewrite for scenarios failed");
    return false;
  }
  if (runNodeNpm("typecheck:scenarios", e2eDir, e2eEnv) !== 0) ok = false;
  if (runNodeNpm("test:scenarios", e2eDir, e2eEnv) !== 0) ok = false;

  mark("job:E2E", ok ? "pass" : "fail");
  return ok;
}

function runContainersJob() {
  if (skipContainers) {
    mark("job:Container verification", "skip", "--skip-containers");
    return true;
  }
  const docker = which("docker") || which("docker.exe");
  if (!docker) {
    mark("job:Container verification", "skip", "docker not available");
    return true;
  }
  let ok = true;
  if (run("docker compose --env-file .env.production.example -f compose.prod.yml config --quiet", {
    cwd: rootDir,
    label: "compose.prod.yml config",
  }) !== 0) {
    ok = false;
  }
  // Full image build + Trivy matches GitHub but is heavy; run build by default
  // when CI_LOCAL_CONTAINERS=1, otherwise only compose config (documented delta).
  if (process.env.CI_LOCAL_CONTAINERS === "1") {
    const builds = [
      ["api", "docker build --target api -t maintenance-api:local ./api"],
      ["migrate", "docker build --target migrate -t maintenance-migrate:local ./api"],
      ["bootstrap", "docker build --target bootstrap -t maintenance-bootstrap:local ./api"],
      ["owner", "docker build --target owner-bootstrap -t maintenance-owner:local ./api"],
      ["web", "docker build --target web -f web/Dockerfile -t maintenance-web:local ."],
    ];
    for (const [name, cmd] of builds) {
      if (run(cmd, { cwd: rootDir, label: `docker build ${name}` }) !== 0) ok = false;
    }
    if (ok) {
      if (run(
        'docker run --rm --entrypoint node maintenance-api:local -e "const {PrismaClient}=require(\'@prisma/client\'); if(!PrismaClient) process.exit(1); console.log(\'Prisma client available\')"',
        { cwd: rootDir, label: "verify runtime Prisma client" },
      ) !== 0) {
        ok = false;
      }
      if (run("node scripts/verify-containers.mjs", {
        cwd: rootDir,
        env: {
          ...process.env,
          API_IMAGE: "maintenance-api:local",
          WEB_IMAGE: "maintenance-web:local",
        },
        label: "verify-containers.mjs",
      }) !== 0) {
        ok = false;
      }
    }
  } else {
    mark(
      "containers:image-build",
      "skip",
      "set CI_LOCAL_CONTAINERS=1 to mirror full image build/verify (Trivy still GitHub-only)",
    );
  }
  mark("job:Container verification", ok ? "pass" : "fail");
  return ok;
}

function printSummary() {
  console.log("\n========== local CI summary ==========");
  for (const r of results) {
    const line = `${r.status.padEnd(4)}  ${r.name}${r.detail ? ` (${r.detail})` : ""}`;
    console.log(line);
  }
  console.log("======================================");
  console.log(`\nLocal vs GitHub CI differences:`);
  console.log(`- Postgres: local Compose ${DEFAULT_PG.host}:${DEFAULT_PG.port} db=${DEFAULT_PG.workingDb} (GitHub service :5432 / maintenance)`);
  console.log(`- Secret scan (Gitleaks): GitHub-only`);
  console.log(`- Dependency review / OSV: GitHub-only`);
  console.log(`- Trivy image scan: GitHub-only`);
  console.log(`- Full container build/verify: opt-in via CI_LOCAL_CONTAINERS=1`);
  console.log(`- Concurrent local CI: blocked by lock file + port ${LOCK_PORT}`);
}

async function main() {
  const started = Date.now();
  console.log("maintenance ci:local — mirroring .github/workflows/ci.yml mandatory jobs");
  try {
    await acquireLock();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }

  const env = baseEnv();
  try {
    if (!ensureDockerDb()) {
      printSummary();
      process.exit(1);
    }
    if (!prepareDatabases(env)) {
      printSummary();
      process.exit(1);
    }

    // Independent jobs: collect failures (do not hide later failures).
    runApiJob(env);
    runWebJob(env);
    runSmokeJob(env);
    runSmokeAuditUpgrade(env);
    runE2eJob(env);
    runContainersJob();

    printSummary();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (failed) {
      console.error(`\nci:local FAILED in ${seconds}s`);
      process.exit(1);
    }
    console.log(`\nci:local PASSED in ${seconds}s`);
    process.exit(0);
  } finally {
    cleanupLock();
  }
}

process.on("SIGINT", () => {
  cleanupLock();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupLock();
  process.exit(143);
});

main().catch((err) => {
  cleanupLock();
  console.error(err);
  process.exit(1);
});
