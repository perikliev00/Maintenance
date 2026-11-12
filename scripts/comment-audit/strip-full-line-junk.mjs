#!/usr/bin/env node
/**
 * Pass 4: remove remaining full-line // junk comments via line scan.
 * Only deletes lines that are entirely a matching comment (plus indent).
 * Verifies TypeScript printer fingerprint (removeComments) is unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("../../web/node_modules/typescript");

const roots = ["api/src", "api/tests", "api/scripts", "api/prisma", "web/src", "e2e", "scripts"];
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git", "comment-audit"]);

const JUNK =
  /^(Execute the next setup or assertion step for this scenario\.|Support the surrounding logic for this step\.|Support the surrounding control flow\.|Open multi-line construct\.|Close multi-line construct with trailing syntax\.|Pagination step for list\/contract coverage\.|Assert response\/page reached the expected status\.|Delivery\/replay step for async notification paths\.|Continue the call chain for setup or assertion detail\.|Import type-only dependency for typing without runtime cost\.|Import dependency used by this module\.|Import module dependency used by this file\.|Import bindings from .+\.|Branch: conditional gate\.|Iterate a collection or counted range\.|Bilingual label for action\/entity key (bg|en)\.|Prisma client types\/runtime for DB setup and assertions\.|Override env for isolation, rate-limit disable, or scheduler quieting\.|Spread prior fields\/items so overrides can layer cleanly\.|Hold a mutable ref that persists across renders without re-render\.|Return the JSX\/UI tree for this render path\.|Memoize callback identity for stable child\/effect deps\.|Assign value for subsequent use\.|Mutable local binding\.|Initialize an (object|array) .+\.|Export type alias for consumers\.|Field value required by this payload or query\.|Carry this field through the payload or query\.|Guard optional cleanup or alternate assertion paths\.|Return the computed result to the caller\.|Begin block\/object for the following statements\.|Seed prerequisite rows so the mutation under test has a realistic baseline\.|task: seeded entity required before the mutation under test\.)$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) walk(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function kindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function fingerprint(text, kind) {
  const sf = ts.createSourceFile("p", text, ts.ScriptTarget.Latest, true, kind);
  return ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(sf)
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `//` at index is outside strings/templates/regex (best-effort). */
function isRealLineComment(line) {
  const m = line.match(/^(\s*)\/\/(.*)$/);
  if (!m) return null;
  // If the line has an odd number of unescaped backticks/quotes before //, skip.
  // Since the // starts after only indent, the whole line is a comment.
  return m[2].trim();
}

let modified = 0;
let removed = 0;
let skipped = 0;

for (const root of roots) {
  for (const file of walk(root)) {
    const original = fs.readFileSync(file, "utf8");
    const nl = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);
    const nextLines = [];
    let fileRemoved = 0;
    for (const line of lines) {
      const body = isRealLineComment(line);
      if (body != null && JUNK.test(body)) {
        fileRemoved++;
        continue;
      }
      nextLines.push(line);
    }
    if (!fileRemoved) continue;
    let next = nextLines.join(nl);
    if (original.endsWith("\n") || original.endsWith("\r\n")) {
      // preserve final newline if present
      if (!next.endsWith("\n")) next += nl;
    }
    next = next.replace(/\n{4,}/g, "\n\n\n").replace(/(\r\n){4,}/g, "\r\n\r\n\r\n");
    const kind = kindFor(file);
    if (fingerprint(original, kind) !== fingerprint(next, kind)) {
      skipped++;
      continue;
    }
    fs.writeFileSync(file, next);
    modified++;
    removed += fileRemoved;
  }
}

console.log(JSON.stringify({ modified, removed, skipped }, null, 2));
