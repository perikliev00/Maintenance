/**
 * Concrete isolation mechanism: preload via `node --import ./tests/registerP1TestEnv.mjs …`
 * Redirects dotenv.config(.env) → .env.p1_test. Sets USE_P1_TEST_ENV=1 for visibility.
 * Does NOT rewrite DATABASE_URL after load (preserves roleGrants ephemeral DBs).
 */
import fs from "node:fs";
// Import module dependency from node:path.
import path from "node:path";
// Import module dependency from node:module.
import { createRequire } from "node:module";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";

// Bind __dirname for use in the following logic.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bind apiRoot for use in the following logic.
const apiRoot = path.resolve(__dirname, "..");
// Bind p1EnvPath for use in the following logic.
const p1EnvPath = path.join(apiRoot, ".env.p1_test");
// CI and local Docker may provide the same dedicated test database at a
// different endpoint. Keep that explicit override across every later dotenv
// load while preserving the database-name isolation check below.
const explicitTestDatabaseUrl = process.env.P1_TEST_DATABASE_URL?.trim();
// Bind explicitTestWebOrigin for use in the following logic.
const explicitTestWebOrigin = process.env.P1_TEST_WEB_ORIGIN?.trim();

// Conditional branch for the case described by this guard.
if (!fs.existsSync(p1EnvPath) && !explicitTestDatabaseUrl) {
  // Abort this path by throwing an error to callers.
  throw new Error(
    // Support the surrounding logic for this step.
    `registerP1TestEnv requires ${p1EnvPath} (do not overwrite api/.env)`,
  );
}

// Pass process.env.USE_P1_TEST_ENV prop/value into the element or config.
process.env.USE_P1_TEST_ENV = "1";

// Bind require for use in the following logic.
const require = createRequire(import.meta.url);
// Bind dotenv for use in the following logic.
const dotenv = require("dotenv");
// Bind originalConfig for use in the following logic.
const originalConfig = dotenv.config.bind(dotenv);

// Support the surrounding logic for this step.
dotenv.config = function patchedConfig(options = {}) {
  // Initialize an object holding related fields.
  const opts = { ...options };
  // Conditional branch for the case described by this guard.
  if (typeof opts.path === "string") {
    // Conditional branch for the case described by this guard.
    if (path.basename(opts.path) === ".env") opts.path = p1EnvPath;
  // Support the surrounding logic for this step.
  } else if (opts.path == null) {
    // Support the surrounding logic for this step.
    opts.path = p1EnvPath;
  }
  // Bind result for use in the following logic.
  const result = originalConfig(opts);
  // Conditional branch for the case described by this guard.
  if (explicitTestDatabaseUrl) {
    // Support the surrounding logic for this step.
    process.env.DATABASE_URL = explicitTestDatabaseUrl;
  }
  // Conditional branch for the case described by this guard.
  if (explicitTestWebOrigin) {
    // Support the surrounding logic for this step.
    process.env.WEB_ORIGIN = explicitTestWebOrigin;
  }
  // Return early result or rendered output from this path.
  return result;
};

// Conditional branch for the case described by this guard.
if (fs.existsSync(p1EnvPath)) {
  // Invoke originalConfig to perform this step.
  originalConfig({ path: p1EnvPath, override: true });
}
// Conditional branch for the case described by this guard.
if (explicitTestDatabaseUrl) {
  // Support the surrounding logic for this step.
  process.env.DATABASE_URL = explicitTestDatabaseUrl;
}
// Conditional branch for the case described by this guard.
if (explicitTestWebOrigin) {
  // Support the surrounding logic for this step.
  process.env.WEB_ORIGIN = explicitTestWebOrigin;
}

// Bind expected for use in the following logic.
const expected =
  // Support the surrounding logic for this step.
  process.env.EXPECTED_TEST_DATABASE?.trim() || "maintenance_p1_test";
// Support the surrounding logic for this step.
process.env.EXPECTED_TEST_DATABASE = expected;

// Bind url for use in the following logic.
const url = process.env.DATABASE_URL ?? "";
// Bind dbName for use in the following logic.
let dbName = "";
// Begin guarded block to catch runtime failures.
try {
  // Support the surrounding logic for this step.
  dbName = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
// Support the surrounding logic for this step.
} catch {
  // Abort this path by throwing an error to callers.
  throw new Error("registerP1TestEnv: invalid DATABASE_URL after .env.p1_test");
}

// Ephemeral roleGrants child DBs (maintenance_t03_grants*) must not be rejected
// when a parent already swapped DATABASE_URL before spawning — skip name check.
if (!/^maintenance_t03_grants/i.test(dbName) && dbName !== expected) {
  // Abort this path by throwing an error to callers.
  throw new Error(
    // Support the surrounding logic for this step.
    `registerP1TestEnv isolation failed: db=${dbName} expected=${expected}`,
  );
}
