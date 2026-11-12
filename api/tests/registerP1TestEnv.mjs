/**
 * Concrete isolation mechanism: preload via `node --import ./tests/registerP1TestEnv.mjs …`
 * Redirects dotenv.config(.env) → .env.p1_test. Sets USE_P1_TEST_ENV=1 for visibility.
 * Does NOT rewrite DATABASE_URL after load (preserves roleGrants ephemeral DBs).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const p1EnvPath = path.join(apiRoot, ".env.p1_test");
// CI and local Docker may provide the same dedicated test database at a
// different endpoint. Keep that explicit override across every later dotenv
// load while preserving the database-name isolation check below.
const explicitTestDatabaseUrl = process.env.P1_TEST_DATABASE_URL?.trim();
const explicitTestWebOrigin = process.env.P1_TEST_WEB_ORIGIN?.trim();

if (!fs.existsSync(p1EnvPath) && !explicitTestDatabaseUrl) {
  // Abort this path by throwing an error to callers.
  throw new Error(
    `registerP1TestEnv requires ${p1EnvPath} (do not overwrite api/.env)`,
  );
}

// Pass process.env.USE_P1_TEST_ENV prop/value into the element or config.
process.env.USE_P1_TEST_ENV = "1";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const originalConfig = dotenv.config.bind(dotenv);

dotenv.config = function patchedConfig(options = {}) {
  const opts = { ...options };
  if (typeof opts.path === "string") {
    if (path.basename(opts.path) === ".env") opts.path = p1EnvPath;
  } else if (opts.path == null) {
    opts.path = p1EnvPath;
  }
  const result = originalConfig(opts);
  if (explicitTestDatabaseUrl) {
    process.env.DATABASE_URL = explicitTestDatabaseUrl;
  }
  if (explicitTestWebOrigin) {
    process.env.WEB_ORIGIN = explicitTestWebOrigin;
  }
  return result;
};

if (fs.existsSync(p1EnvPath)) {
  originalConfig({ path: p1EnvPath, override: true });
}
if (explicitTestDatabaseUrl) {
  process.env.DATABASE_URL = explicitTestDatabaseUrl;
}
if (explicitTestWebOrigin) {
  process.env.WEB_ORIGIN = explicitTestWebOrigin;
}

const expected =
  process.env.EXPECTED_TEST_DATABASE?.trim() || "maintenance_p1_test";
process.env.EXPECTED_TEST_DATABASE = expected;

const url = process.env.DATABASE_URL ?? "";
let dbName = "";
try {
  dbName = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
} catch {
  // Abort this path by throwing an error to callers.
  throw new Error("registerP1TestEnv: invalid DATABASE_URL after .env.p1_test");
}

// Ephemeral roleGrants child DBs (maintenance_t03_grants*) must not be rejected
// when a parent already swapped DATABASE_URL before spawning — skip name check.
if (!/^maintenance_t03_grants/i.test(dbName) && dbName !== expected) {
  // Abort this path by throwing an error to callers.
  throw new Error(
    `registerP1TestEnv isolation failed: db=${dbName} expected=${expected}`,
  );
}
