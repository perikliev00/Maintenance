#!/usr/bin/env node
/**
 * Pass 2: remove remaining redundant // comments via scanner trivia tokens.
 * Catches detached comments that AST leading/trailing ranges miss.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("../../web/node_modules/typescript");

// Reuse classifier by evaluating patterns from pass1 module text is heavy;
// duplicate a focused shouldRemove here + import via dynamic for EXACT set.
const pass1url = pathToFileURL(
  path.resolve("scripts/comment-audit/strip-redundant-comments.mjs"),
).href;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const roots = ["api/src", "api/tests", "api/scripts", "api/prisma", "web/src", "e2e", "scripts"];
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git", "comment-audit"]);

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

function scriptKindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function scriptKindExt(kind) {
  switch (kind) {
    case ts.ScriptKind.TSX:
      return ".tsx";
    case ts.ScriptKind.JSX:
      return ".jsx";
    case ts.ScriptKind.JS:
      return ".js";
    default:
      return ".ts";
  }
}

function fingerprint(text, kind) {
  const sf = ts.createSourceFile("probe" + scriptKindExt(kind), text, ts.ScriptTarget.Latest, true, kind);
  return ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(sf)
    .replace(/\s+/g, " ")
    .trim();
}

const PRESERVE = [/^@ts-/, /^eslint-/, /^oxlint-/, /^prettier-/, /^TODO\b/i, /^FIXME\b/i, /^NOTE\b/i, /^WARNING\b/i, /^SECURITY\b/i, /^IMPORTANT\b/i];

function shouldRemoveBody(body) {
  if (!body || PRESERVE.some((re) => re.test(body))) return false;
  // Broad but still narration-oriented patterns remaining after pass1.
  const exactish = [
    "Support the surrounding logic for this step.",
    "Support the surrounding control flow.",
    "Execute the next setup or assertion step for this scenario.",
    "Open multi-line construct.",
    "Close multi-line construct with trailing syntax.",
    "Begin block/object for the following statements.",
    "Import dependency used by this module.",
    "Import module dependency used by this file.",
    "Pagination step for list/contract coverage.",
    "Seed prerequisite rows so the mutation under test has a realistic baseline.",
    "Memoize callback identity for stable child/effect deps.",
    "Assert response/page reached the expected status.",
    "Delivery/replay step for async notification paths.",
    "Initialize an object holding related fields.",
    "Continue the call chain for setup or assertion detail.",
    "Export type alias for consumers.",
    "Assign value for subsequent use.",
    "Mutable local binding.",
    "Field value required by this payload or query.",
    "Guard optional cleanup or alternate assertion paths.",
    "Carry this field through the payload or query.",
    "Return the computed result to the caller.",
    "Initialize an array used by subsequent logic.",
    "Declare type alias Action.",
    "Declare type alias Panel.",
    "Provide technician field used by this structure.",
    "Provide reception field used by this structure.",
  ];
  if (exactish.includes(body)) return true;
  if (/^Support the surrounding/.test(body)) return true;
  if (/^Execute the next setup/.test(body)) return true;
  if (/^Provide \w+ field used by this structure\.?$/.test(body)) return true;
  if (/^Declare type alias \w+\.?$/.test(body)) return true;
  if (/^Declare a type alias\.?$/.test(body)) return true;
  if (/^Import (module )?dependency/.test(body)) return true;
  if (/^Pass \w+ prop\/value/.test(body)) return true;
  if (/^Render a </.test(body)) return true;
  if (/^Invoke \w+/.test(body) && /perform this step/.test(body)) return true;
  if (/^Param \w+ /.test(body)) return true;
  if (/^Field \w+ on this /.test(body)) return true;
  if (/^Bind \w+ for /.test(body)) return true;
  if (/^Capture \w+ for /.test(body)) return true;
  if (/^Update \w+ as control flow/.test(body)) return true;
  if (/^Load \w+ asynchronously/.test(body)) return true;
  if (/^Run next step:/.test(body)) return true;
  if (/^Await (async work|side effect)/.test(body)) return true;
  if (/^Return (computed|the arranged|early|response)/.test(body)) return true;
  if (/^Local (constant binding|type alias|binding)/.test(body)) return true;
  if (/^Open multi-line/.test(body)) return true;
  if (/^Close multi-line/.test(body)) return true;
  if (/^Begin block\/object/.test(body)) return true;
  if (/^Continue (multi-line|the call chain)/.test(body)) return true;
  if (/^Assign value for subsequent use/.test(body)) return true;
  if (/^Mutable local binding/.test(body)) return true;
  if (/^Initialize an (object|array)/.test(body)) return true;
  if (/^Export type alias/.test(body)) return true;
  if (/^Memoize callback identity/.test(body)) return true;
  if (/^Pagination step/.test(body)) return true;
  if (/^Delivery\/replay step/.test(body)) return true;
  if (/^Field value required by this payload/.test(body)) return true;
  if (/^Carry this field through/.test(body)) return true;
  if (/^Guard optional cleanup/.test(body)) return true;
  if (/^Assert (response\/page|HTTP status|the observed|expected|collection size|browser|UI)/.test(body)) return true;
  if (/^Seed prerequisite rows/.test(body)) return true;
  if (/^Arrange or act for this test case/.test(body)) return true;
  if (/^Update React state so the UI/.test(body)) return true;
  if (/^Conditional (branch|path)/.test(body)) return true;
  if (/^List item in import/.test(body)) return true;
  if (/^Arrow function \/ callback body/.test(body)) return true;
  if (/^Unit test case/.test(body)) return true;
  if (/^Define a single test case/.test(body)) return true;
  if (/^Group related tests/.test(body)) return true;
  if (/^Wait for (an async|the async)/.test(body)) return true;
  if (/^SQL fragment used to observe/.test(body)) return true;
  if (/^Concurrency\/isolation step/.test(body)) return true;
  if (/^Session\/CSRF step/.test(body)) return true;
  if (/^Try path where partial failure/.test(body)) return true;
  if (/^React state slot/.test(body)) return true;
  if (/^Shared Prisma client singleton/.test(body)) return true;
  if (/^Runtime import from /.test(body)) return true;
  if (/^Type-only import/.test(body)) return true;
  if (/^Module import required below/.test(body)) return true;
  if (/^Filter matching rows/.test(body)) return true;
  if (/^Select only needed columns/.test(body)) return true;
  if (/^Include relations for labels/.test(body)) return true;
  if (/^Mutation data payload/.test(body)) return true;
  if (/^Stable sort for paging/.test(body)) return true;
  if (/^Page (size limit|offset)/.test(body)) return true;
  if (/^Prisma side effect/.test(body)) return true;
  if (/^Persist field updates/.test(body)) return true;
  if (/^Insert required row/.test(body)) return true;
  if (/^Delete obsolete row/.test(body)) return true;
  if (/^Destructure /.test(body)) return true;
  if (/^Early exit/.test(body)) return true;
  if (/^Fallback branch/.test(body)) return true;
  if (/^Alternate mutually exclusive/.test(body)) return true;
  if (/^Additional clause in this boolean/.test(body)) return true;
  if (/^Throw typed AppError/.test(body)) return true;
  if (/^Abort with an error/.test(body)) return true;
  if (/^Catch locally so callers/.test(body)) return true;
  if (/^Handle or remap the failure/.test(body)) return true;
  if (/^Cleanup that must always run/.test(body)) return true;
  if (/^Begin guarded block/.test(body)) return true;
  if (/^State transition/.test(body)) return true;
  if (/^Return value \/ early exit/.test(body)) return true;
  if (/^Render UI node/.test(body)) return true;
  if (/^Clone catalog defaults/.test(body)) return false; // borderline useful — keep
  return false;
}

function collectTriviaComments(text, kind) {
  const variant =
    kind === ts.ScriptKind.TSX || kind === ts.ScriptKind.JSX
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false, variant, text);
  const ranges = [];
  while (true) {
    const k = scanner.scan();
    if (k === ts.SyntaxKind.EndOfFileToken) break;
    if (k === ts.SyntaxKind.SingleLineCommentTrivia) {
      const start = scanner.getTokenPos();
      const end = scanner.getTextPos();
      ranges.push({ pos: start, end });
    }
    // Intentionally skip MultiLineCommentTrivia to preserve JSDoc.
  }
  return ranges.sort((a, b) => b.pos - a.pos);
}

function stripFile(file) {
  const original = fs.readFileSync(file, "utf8");
  const kind = scriptKindFor(file);
  const ranges = collectTriviaComments(original, kind);
  const removals = [];
  for (const r of ranges) {
    const raw = original.slice(r.pos, r.end);
    const body = raw.replace(/^\/\//, "").trim();
    if (shouldRemoveBody(body)) removals.push(r);
  }
  if (!removals.length) return { file, removed: 0, changed: false };

  let next = original;
  for (const r of removals) {
    let start = r.pos;
    let end = r.end;
    const lineStart = next.lastIndexOf("\n", start - 1) + 1;
    const after = next.slice(end);
    const beforeSeg = next.slice(lineStart, start);
    const onlyIndentBefore = /^\s*$/.test(beforeSeg);
    const newlineAfter = after.match(/^\r?\n/);
    if (onlyIndentBefore && newlineAfter) {
      start = lineStart;
      end = end + newlineAfter[0].length;
    } else if (start > 0 && /\s/.test(next[start - 1])) {
      start -= 1;
    }
    next = next.slice(0, start) + next.slice(end);
  }
  next = next.replace(/\n{4,}/g, "\n\n\n");

  if (fingerprint(original, kind) !== fingerprint(next, kind)) {
    return { file, removed: 0, changed: false, error: "fingerprint mismatch; skipped" };
  }
  if (!dryRun) fs.writeFileSync(file, next);
  return { file, removed: removals.length, changed: true };
}

const results = [];
const errors = [];
for (const root of roots) {
  for (const file of walk(root)) {
    try {
      results.push(stripFile(file));
    } catch (e) {
      errors.push({ file, error: String(e) });
    }
  }
}

const changed = results.filter((r) => r.changed);
console.log(
  JSON.stringify(
    {
      dryRun,
      filesScanned: results.length,
      filesModified: changed.length,
      commentRangesRemoved: results.reduce((s, r) => s + r.removed, 0),
      skippedForSafety: results.filter((r) => r.error).length,
      skipSample: results.filter((r) => r.error).slice(0, 15),
      errorCount: errors.length,
    },
    null,
    2,
  ),
);

void pass1url;
