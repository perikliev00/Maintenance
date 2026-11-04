/**
 * Fail CI when a backend *.test.ts file is outside every mandatory runner glob.
 * Distinguishes "selected by a runner" from "executed in this process".
 *
 * Usage: node ./scripts/assert-test-inventory.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Globs that CI Smoke (or equivalent) must actually invoke. */
const MANDATORY_RUNNER_GLOBS = [
  "src/**/*.test.ts",
  "tests/scenarios/*.test.ts",
  "tests/cleaning/**/*.test.ts",
  "tests/readiness/**/*.test.ts",
  "tests/tickets/**/*.test.ts",
  "tests/plan/**/*.test.ts",
  "tests/sectors/**/*.test.ts",
  "tests/shifts/**/*.test.ts",
  "tests/my-work/**/*.test.ts",
  "tests/attendance/**/*.test.ts",
  "tests/cards/**/*.test.ts",
  "tests/people/**/*.test.ts",
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Minimal ** / * matcher for relative posix paths. */
function matchGlob(relPosix, glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "<<<DS>>>")
    .replace(/\*\*/g, "<<<D>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<DS>>>/g, "(?:.*/)?")
    .replace(/<<<D>>>/g, ".*");
  return new RegExp(`^${escaped}$`).test(relPosix);
}

const files = [
  ...walk(path.join(apiRoot, "src")),
  ...walk(path.join(apiRoot, "tests")),
].map((abs) => path.relative(apiRoot, abs).split(path.sep).join("/"));

const orphans = files.filter(
  (rel) => !MANDATORY_RUNNER_GLOBS.some((g) => matchGlob(rel, g)),
);

console.log(
  JSON.stringify(
    {
      testFileCount: files.length,
      mandatoryGlobs: MANDATORY_RUNNER_GLOBS,
      orphanCount: orphans.length,
      orphans,
    },
    null,
    2,
  ),
);

if (orphans.length) {
  console.error(
    `assert-test-inventory: ${orphans.length} test file(s) outside mandatory runners`,
  );
  process.exit(1);
}
