/**
 * Positive isolation proof: spawn a real worker under
 *   node --import registerP1TestEnv.mjs --import tsx <worker>
 * with a poisoned shell DATABASE_URL pointing at the working DB name.
 * Worker must still resolve to maintenance_p1_test after dotenv(.env) override
 * and confirm current_database().
 *
 * Negative control (safe): spawn the same worker WITHOUT the register preload
 * but with DATABASE_URL rewritten to a non-connectable marker host; assert the
 * process sees the working-db name from .env (or marker) and exits non-zero
 * before any Prisma connect when ISOLATION_NEG=1.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
// Relative paths — Windows rejects absolute `C:\…` with --import.
const worker = "./tests/proveP1Isolation.worker.mjs";
const register = "./tests/registerP1TestEnv.mjs";
const negWorker = "./tests/proveP1Isolation.negative.mjs";

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

// --- Positive: register + tsx loader ---
const pos = run(["--import", register, "--import", "tsx", worker]);
assert.equal(
  pos.status,
  0,
  `positive isolation worker failed:\n${pos.stdout}\n${pos.stderr}`,
);
assert.match(pos.stdout, /prove_p1_isolation_worker_ok maintenance_p1_test/);

// --- Negative (safe): no register; marker URL never connected ---
const neg = run(["--import", "tsx", negWorker], {
  DATABASE_URL:
    "postgresql://isolation_probe:isolation_probe@127.0.0.1:1/maintenance_ISOLATION_MARKER?schema=public",
});
assert.equal(
  neg.status,
  0,
  `negative isolation control failed:\n${neg.stdout}\n${neg.stderr}`,
);
assert.match(neg.stdout, /prove_p1_isolation_negative_ok/);

console.log("prove_p1_isolation_ok maintenance_p1_test");
