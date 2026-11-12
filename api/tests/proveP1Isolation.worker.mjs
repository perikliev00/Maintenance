/**
 * Real test-worker simulation: load api/.env with override:true after the
 * registerP1TestEnv preload, then prove DATABASE_URL + current_database().
 */
import assert from "node:assert/strict";
// Import module dependency from node:path.
import path from "node:path";
// Import module dependency from node:module.
import { createRequire } from "node:module";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";
// Import module dependency from @prisma/client.
import { PrismaClient } from "@prisma/client";

// Bind require for use in the following logic.
const require = createRequire(import.meta.url);
// Bind dotenv for use in the following logic.
const dotenv = require("dotenv");
// Bind apiRoot for use in the following logic.
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
assert.ok(url, "DATABASE_URL required after dotenv override");
// Filter items down to those relevant for this view.
const dbName = new URL(url).pathname.split("/").filter(Boolean).pop();
// Invoke assert.equal to perform this step.
assert.equal(
  // Support the surrounding logic for this step.
  dbName,
  // Support the surrounding logic for this step.
  "maintenance_p1_test",
  // Support the surrounding logic for this step.
  `worker dotenv override leaked working DB: ${dbName}`,
);

// Bind prisma for use in the following logic.
const prisma = new PrismaClient();
// Begin guarded block to catch runtime failures.
try {
  // Bind rows for use in the following logic.
  const rows = await prisma.$queryRaw`SELECT current_database() AS name`;
  // Invoke assert.equal to perform this step.
  assert.equal(
    // Support the surrounding logic for this step.
    rows[0]?.name,
    // Support the surrounding logic for this step.
    "maintenance_p1_test",
    // Support the surrounding logic for this step.
    `current_database()=${rows[0]?.name}`,
  );
  // Emit diagnostic output for debugging this path.
  console.log("prove_p1_isolation_worker_ok", rows[0].name);
// Support the surrounding logic for this step.
} finally {
  // Wait for an async operation before continuing.
  await prisma.$disconnect();
}
