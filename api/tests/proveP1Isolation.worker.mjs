/**
 * Real test-worker simulation: load api/.env with override:true after the
 * registerP1TestEnv preload, then prove DATABASE_URL + current_database().
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({
  path: process.argv[2] ?? path.join(apiRoot, ".env"),
  override: true,
});

const url = process.env.DATABASE_URL;
assert.ok(url, "DATABASE_URL required after dotenv override");
// Filter items down to those relevant for this view.
const dbName = new URL(url).pathname.split("/").filter(Boolean).pop();
assert.equal(
  dbName,
  "maintenance_p1_test",
  `worker dotenv override leaked working DB: ${dbName}`,
);

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(
    rows[0]?.name,
    "maintenance_p1_test",
    `current_database()=${rows[0]?.name}`,
  );
  // Emit diagnostic output for debugging this path.
  console.log("prove_p1_isolation_worker_ok", rows[0].name);
} finally {
  await prisma.$disconnect();
}
