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
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
// Relative paths — Windows rejects absolute `C:\…` with --import.
const worker = "./tests/proveP1Isolation.worker.mjs";
const register = "./tests/registerP1TestEnv.mjs";
const negWorker = "./tests/proveP1Isolation.negative.mjs";

// Define function run and its behavior.
function run(args, envExtra = {}) {
  return spawnSync(process.execPath, args, {
    cwd: apiRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      // Poison: pretend shell still points at working DB.
      DATABASE_URL:
        "postgresql://maintenance:maintenance@localhost:5433/maintenance?schema=public",
      ...envExtra,
    },
  });
}

// Exercise the same override in both workers without reading or replacing a
// developer's .env. CI needs no working-database configuration for this proof.
const fixtureDir = mkdtempSync(path.join(tmpdir(), "maintenance-isolation-"));
const fixture = path.join(fixtureDir, ".env");
writeFileSync(fixture, 'DATABASE_URL="postgresql://probe:probe@fixture.invalid:1/maintenance_fixture?schema=public"\n');
try {
  // --- Positive: register + tsx loader ---
  const pos = run(["--import", register, "--import", "tsx", worker, fixture]);
  assert.equal(
    pos.status,
    // Expect a successful zero exit status for the positive worker.
    0,
    `positive isolation worker failed:\n${pos.stdout}\n${pos.stderr}`,
  );
  assert.match(pos.stdout, /prove_p1_isolation_worker_ok maintenance_p1_test/);

  // --- Negative (safe): no register; marker URL never connected ---
  const neg = run(["--import", "tsx", negWorker, fixture], {
    DATABASE_URL:
      "postgresql://isolation_probe:isolation_probe@127.0.0.1:1/maintenance_ISOLATION_MARKER?schema=public",
  });
  assert.equal(
    neg.status,
    // Expect a successful zero exit status for the negative control.
    0,
    `negative isolation control failed:\n${neg.stdout}\n${neg.stderr}`,
  );
  assert.match(neg.stdout, /prove_p1_isolation_negative_ok/);

  // Emit diagnostic output for debugging this path.
  console.log("prove_p1_isolation_ok maintenance_p1_test");
} finally {
  rmSync(fixture, { force: true });
  // Only the exact temporary directory created above is removed, non-recursively.
  rmdirSync(fixtureDir);
}
