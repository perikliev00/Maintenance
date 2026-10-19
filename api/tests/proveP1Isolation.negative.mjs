/**
 * Safe negative control: WITHOUT registerP1TestEnv, dotenv.config(.env, override)
 * restores the working DB name from api/.env. We assert that name is NOT the
 * isolated test DB — proving the patch is required — without connecting.
 *
 * Shell may pass a marker DATABASE_URL; after override it must become whatever
 * api/.env says (typically `maintenance`), never silently stay on p1_test
 * without the preload.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const before = process.env.DATABASE_URL ?? "";
assert.match(
  before,
  /maintenance_ISOLATION_MARKER|127\.0\.0\.1:1/,
  "negative control must start from non-connectable marker URL",
);

dotenv.config({
  path: path.join(apiRoot, ".env"),
  override: true,
});

const url = process.env.DATABASE_URL;
assert.ok(url, "DATABASE_URL required");
const dbName = new URL(url).pathname.split("/").filter(Boolean).pop();

// Without the patch, working .env wins — must NOT be the isolated test DB.
assert.notEqual(
  dbName,
  "maintenance_p1_test",
  "negative control: unpatched dotenv unexpectedly kept maintenance_p1_test",
);
assert.ok(
  !/127\.0\.0\.1:1|ISOLATION_MARKER/.test(url),
  "negative control: marker URL should have been overwritten by .env",
);

console.log("prove_p1_isolation_negative_ok", dbName);
