#!/usr/bin/env node
/**
 * Point this repository's Git hooksPath at scripts/ci/hooks (tracked pre-push).
 * Safe to re-run. Does not modify global git config.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hooksPath = "scripts/ci/hooks";
const absHooks = path.join(rootDir, hooksPath);
const prePush = path.join(absHooks, "pre-push");

if (!fs.existsSync(prePush)) {
  console.error(`Missing ${prePush}`);
  process.exit(1);
}

try {
  fs.chmodSync(prePush, 0o755);
} catch {
  // Windows may ignore chmod; Git Bash still executes the hook.
}

const result = spawnSync("git", ["config", "core.hooksPath", hooksPath], {
  cwd: rootDir,
  stdio: "inherit",
});

if ((result.status ?? 1) !== 0) {
  console.error("Failed to set core.hooksPath");
  process.exit(result.status ?? 1);
}

const verify = spawnSync("git", ["config", "--get", "core.hooksPath"], {
  cwd: rootDir,
  encoding: "utf8",
});
console.log(`core.hooksPath=${(verify.stdout || "").trim()}`);
console.log("Git pre-push hook installed. Pushes will run: npm run ci:local");
console.log("See docs/testing/LOCAL_CI.md for details.");
