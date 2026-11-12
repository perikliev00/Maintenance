/**
 * Safe negative control: WITHOUT registerP1TestEnv, dotenv.config(.env, override)
 * loads a self-contained temporary .env. We assert that name is NOT the
 * isolated test DB — proving the patch is required — without connecting.
 *
 * The marker DATABASE_URL must become maintenance_fixture without the preload.
 */
import assert from "node:assert/strict";
// Import module dependency from node:path.
import path from "node:path";
// Import module dependency from node:module.
import { createRequire } from "node:module";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";

// Bind require for use in the following logic.
const require = createRequire(import.meta.url);
// Bind dotenv for use in the following logic.
const dotenv = require("dotenv");
// Bind apiRoot for use in the following logic.
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Bind before for use in the following logic.
const before = process.env.DATABASE_URL ?? "";
// Invoke assert.match to perform this step.
assert.match(
  // Support the surrounding logic for this step.
  before,
  // Support the surrounding logic for this step.
  /maintenance_ISOLATION_MARKER|127\.0\.0\.1:1/,
  // Support the surrounding logic for this step.
  "negative control must start from non-connectable marker URL",
);

// Invoke dotenv.config to perform this step.
dotenv.config({
  // Provide path field used by this structure.
  path: process.argv[2] ?? path.join(apiRoot, ".env"),
  // Provide override field used by this structure.
  override: true,
});

// Bind url for use in the following logic.
const url = process.env.DATABASE_URL;
// Invoke assert.ok to perform this step.
assert.ok(url, "DATABASE_URL required");
// Filter items down to those relevant for this view.
const dbName = new URL(url).pathname.split("/").filter(Boolean).pop();

// Without the patch, fixture .env wins — must NOT be the isolated test DB.
assert.notEqual(
  // Support the surrounding logic for this step.
  dbName,
  // Support the surrounding logic for this step.
  "maintenance_p1_test",
  // Support the surrounding logic for this step.
  "negative control: unpatched dotenv unexpectedly kept maintenance_p1_test",
);
// Invoke assert.ok to perform this step.
assert.ok(
  // Support the surrounding logic for this step.
  !/127\.0\.0\.1:1|ISOLATION_MARKER/.test(url),
  // Support the surrounding logic for this step.
  "negative control: marker URL should have been overwritten by .env",
);
// Invoke assert.equal to perform this step.
assert.equal(dbName, "maintenance_fixture", "self-contained .env fixture must win");

// Emit diagnostic output for debugging this path.
console.log("prove_p1_isolation_negative_ok", dbName);
