/**
 * Run node:test under proven isolation:
 *   node --import ./tests/registerP1TestEnv.mjs --import tsx --test …
 *
 * Do NOT use tsx/dist/cli.mjs as the entry — that process does not keep the
 * dotenv.config monkey-patch for workers that later load api/.env.
 *
 * Usage: node ./tests/runWithP1Isolation.mjs [--test-concurrency=N] <glob…>
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
// Relative --import paths (Windows ESM requires file:// for absolute paths).
const nodeArgs = [
  "--import",
  "./tests/registerP1TestEnv.mjs",
  "--import",
  "tsx",
  "--test",
];
const globs = [];
for (const a of args) {
  if (a.startsWith("--")) nodeArgs.push(a);
  else globs.push(a);
}

const files = [];
for (const g of globs) {
  const pattern = path.isAbsolute(g) ? g : path.join(apiRoot, g);
  const matched = globSync(pattern.replace(/\\/g, "/"), {
    windowsPathsNoEscape: true,
  });
  if (matched.length === 0) {
    files.push(path.relative(apiRoot, pattern) || pattern);
  } else {
    for (const m of matched) {
      files.push(path.relative(apiRoot, path.resolve(m)).replace(/\\/g, "/"));
    }
  }
}

if (files.length === 0) {
  // Emit diagnostic output for debugging this path.
  console.error("runWithP1Isolation: no test files matched", globs);
  process.exit(1);
}

files.sort();
const result = spawnSync(process.execPath, [...nodeArgs, ...files], {
  cwd: apiRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
