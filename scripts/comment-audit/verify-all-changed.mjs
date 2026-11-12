#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("../../web/node_modules/typescript");

const names = execSync("git diff --name-only HEAD", {
  encoding: "utf8",
  maxBuffer: 20e6,
})
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const allowed = names.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
const disallowed = names.filter((f) => !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));

function kindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
function ext(kind) {
  return kind === ts.ScriptKind.TSX ? ".tsx" : kind === ts.ScriptKind.JSX ? ".jsx" : kind === ts.ScriptKind.JS ? ".js" : ".ts";
}
function fp(text, kind) {
  const sf = ts.createSourceFile("p" + ext(kind), text, ts.ScriptTarget.Latest, true, kind);
  return ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(sf)
    .replace(/\s+/g, " ")
    .trim();
}

const mismatches = [];
for (const file of allowed) {
  if (!fs.existsSync(file)) {
    mismatches.push({ file, error: "missing working tree file" });
    continue;
  }
  let before;
  try {
    before = execSync(`git show HEAD:${file.replace(/\\/g, "/")}`, {
      encoding: "utf8",
      maxBuffer: 10e6,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    mismatches.push({ file, error: "not in HEAD (new file?)" });
    continue;
  }
  const after = fs.readFileSync(file, "utf8");
  const kind = kindFor(file);
  if (fp(before, kind) !== fp(after, kind)) {
    mismatches.push({ file, error: "executable fingerprint changed" });
  }
}

console.log(
  JSON.stringify(
    {
      changedFiles: names.length,
      allowedSourceFiles: allowed.length,
      disallowedFiles: disallowed,
      fingerprintMismatches: mismatches.length,
      mismatchSample: mismatches.slice(0, 30),
      ok: disallowed.length === 0 && mismatches.length === 0,
    },
    null,
    2,
  ),
);
process.exit(disallowed.length === 0 && mismatches.length === 0 ? 0 : 1);
