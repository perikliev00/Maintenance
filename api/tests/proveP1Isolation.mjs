/**
 * Positive isolation proof: spawn a real worker under
 *   node --import registerP1TestEnv.mjs --import tsx <worker>
 * with a poisoned shell DATABASE_URL pointing at the working DB name.
 * Worker must still resolve to maintenance_p1_test after dotenv(.env) override
 * and confirm current_database().
 *
 * Negative control (safe): without the preload, the same temporary .env must
 * replace the non-connectable shell marker with maintenance_fixture. The
 * negative worker makes no database connection. Neither worker needs api/.env.
 */
import assert from "node:assert/strict";
// Import module dependency from node:child_process.
import { spawnSync } from "node:child_process";
// Import module dependency from node:path.
import path from "node:path";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";
// Import module dependency from node:fs.
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
// Import module dependency from node:os.
import { tmpdir } from "node:os";

// Bind __dirname for use in the following logic.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bind apiRoot for use in the following logic.
const apiRoot = path.resolve(__dirname, "..");
// Relative paths — Windows rejects absolute `C:\…` with --import.
const worker = "./tests/proveP1Isolation.worker.mjs";
// Bind register for use in the following logic.
const register = "./tests/registerP1TestEnv.mjs";
// Bind negWorker for use in the following logic.
const negWorker = "./tests/proveP1Isolation.negative.mjs";

// Define function run and its behavior.
function run(args, envExtra = {}) {
  // Return early result or rendered output from this path.
  return spawnSync(process.execPath, args, {
    // Provide cwd field used by this structure.
    cwd: apiRoot,
    // Provide encoding field used by this structure.
    encoding: "utf8",
    // Provide env field used by this structure.
    env: {
      // Spread prior fields/items so overrides can layer cleanly.
      ...process.env,
      // Poison: pretend shell still points at working DB.
      DATABASE_URL:
        // Support the surrounding logic for this step.
        "postgresql://maintenance:maintenance@localhost:5433/maintenance?schema=public",
      // Spread prior fields/items so overrides can layer cleanly.
      ...envExtra,
    },
  });
}

// Exercise the same override in both workers without reading or replacing a
// developer's .env. CI needs no working-database configuration for this proof.
const fixtureDir = mkdtempSync(path.join(tmpdir(), "maintenance-isolation-"));
// Bind fixture for use in the following logic.
const fixture = path.join(fixtureDir, ".env");
// Invoke writeFileSync to perform this step.
writeFileSync(fixture, 'DATABASE_URL="postgresql://probe:probe@fixture.invalid:1/maintenance_fixture?schema=public"\n');
// Begin guarded block to catch runtime failures.
try {
  // --- Positive: register + tsx loader ---
  const pos = run(["--import", register, "--import", "tsx", worker, fixture]);
  // Invoke assert.equal to perform this step.
  assert.equal(
    // Support the surrounding logic for this step.
    pos.status,
    // Expect a successful zero exit status for the positive worker.
    0,
    // Support the surrounding logic for this step.
    `positive isolation worker failed:\n${pos.stdout}\n${pos.stderr}`,
  );
  // Invoke assert.match to perform this step.
  assert.match(pos.stdout, /prove_p1_isolation_worker_ok maintenance_p1_test/);

  // --- Negative (safe): no register; marker URL never connected ---
  const neg = run(["--import", "tsx", negWorker, fixture], {
    // Provide DATABASE_URL field used by this structure.
    DATABASE_URL:
      // Support the surrounding logic for this step.
      "postgresql://isolation_probe:isolation_probe@127.0.0.1:1/maintenance_ISOLATION_MARKER?schema=public",
  });
  // Invoke assert.equal to perform this step.
  assert.equal(
    // Support the surrounding logic for this step.
    neg.status,
    // Expect a successful zero exit status for the negative control.
    0,
    // Support the surrounding logic for this step.
    `negative isolation control failed:\n${neg.stdout}\n${neg.stderr}`,
  );
  // Invoke assert.match to perform this step.
  assert.match(neg.stdout, /prove_p1_isolation_negative_ok/);

  // Emit diagnostic output for debugging this path.
  console.log("prove_p1_isolation_ok maintenance_p1_test");
// Support the surrounding logic for this step.
} finally {
  // Invoke rmSync to perform this step.
  rmSync(fixture, { force: true });
  // Only the exact temporary directory created above is removed, non-recursively.
  rmdirSync(fixtureDir);
}
