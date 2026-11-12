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
// Import module dependency from node:fs.
import { globSync } from "node:fs";
// Import module dependency from node:path.
import path from "node:path";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";

// Bind __dirname for use in the following logic.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bind apiRoot for use in the following logic.
const apiRoot = path.resolve(__dirname, "..");

// Bind args for use in the following logic.
const args = process.argv.slice(2);
// Relative --import paths (Windows ESM requires file:// for absolute paths).
const nodeArgs = [
  // Support the surrounding logic for this step.
  "--import",
  // Support the surrounding logic for this step.
  "./tests/registerP1TestEnv.mjs",
  // Support the surrounding logic for this step.
  "--import",
  // Support the surrounding logic for this step.
  "tsx",
  // Support the surrounding logic for this step.
  "--test",
];
// Initialize an array used by subsequent logic.
const globs = [];
// Iterate a collection or counted range.
for (const a of args) {
  // Conditional branch for the case described by this guard.
  if (a.startsWith("--")) nodeArgs.push(a);
  // Fallback branch when earlier conditions were false.
  else globs.push(a);
}

// Initialize an array used by subsequent logic.
const files = [];
// Iterate a collection or counted range.
for (const g of globs) {
  // Bind pattern for use in the following logic.
  const pattern = path.isAbsolute(g) ? g : path.join(apiRoot, g);
  // Bind matched for use in the following logic.
  const matched = globSync(pattern.replace(/\\/g, "/"), {
    // Provide windowsPathsNoEscape field used by this structure.
    windowsPathsNoEscape: true,
  });
  // Conditional branch for the case described by this guard.
  if (matched.length === 0) {
    // Invoke files.push to perform this step.
    files.push(path.relative(apiRoot, pattern) || pattern);
  // Support the surrounding logic for this step.
  } else {
    // Iterate a collection or counted range.
    for (const m of matched) {
      // Invoke files.push to perform this step.
      files.push(path.relative(apiRoot, path.resolve(m)).replace(/\\/g, "/"));
    }
  }
}

// Conditional branch for the case described by this guard.
if (files.length === 0) {
  // Emit diagnostic output for debugging this path.
  console.error("runWithP1Isolation: no test files matched", globs);
  // Invoke process.exit to perform this step.
  process.exit(1);
}

// Invoke files.sort to perform this step.
files.sort();
// Bind result for use in the following logic.
const result = spawnSync(process.execPath, [...nodeArgs, ...files], {
  // Provide cwd field used by this structure.
  cwd: apiRoot,
  // Provide stdio field used by this structure.
  stdio: "inherit",
  // Provide env field used by this structure.
  env: process.env,
});

// Invoke process.exit to perform this step.
process.exit(result.status ?? 1);
