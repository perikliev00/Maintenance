#!/usr/bin/env node
/**
 * Verifies that a git diff against a baseline contains only newly inserted
 * comment lines (and blank lines that accompany them). Exits non-zero if any
 * original code line was modified, deleted, or reordered.
 *
 * Usage: node scripts/verify-comment-only-diff.mjs [baselineRef]
 * Default baseline: HEAD (working tree vs index+HEAD via git diff)
 */
import { execSync } from "node:child_process";

const baseline = process.argv[2] ?? "HEAD";

function isCommentLine(line, ext) {
  const t = line.trim();
  if (!t) return true; // allow blank insertions next to comments
  if (ext === ".css" || ext === ".scss") {
    return t.startsWith("/*") || t.startsWith("*") || t.startsWith("//") || t.endsWith("*/");
  }
  if (ext === ".sh" || ext === ".ps1") {
    return t.startsWith("#");
  }
  if (ext === ".sql") {
    return t.startsWith("--") || t.startsWith("/*") || t.startsWith("*");
  }
  // default: JS/TS/JSX/TSX/mjs and Dockerfiles
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.endsWith("*/") ||
    t.startsWith("#") // Dockerfile / shebang-adjacent
  );
}

function extOf(path) {
  const m = path.match(/(\.[a-z0-9]+)$/i);
  if (path.endsWith("Dockerfile") || path.includes("Dockerfile.")) return ".dockerfile";
  return m ? m[1].toLowerCase() : "";
}

const raw = execSync(`git diff -U0 ${baseline}`, {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (!raw.trim()) {
  console.log("No changes vs", baseline);
  process.exit(0);
}

let file = null;
let violations = [];
let addedComments = 0;
let filesTouched = new Set();
let deletedLines = 0;
let modifiedSuspect = 0;

for (const line of raw.split(/\r?\n/)) {
  if (line.startsWith("diff --git ")) {
    const parts = line.split(" ");
    file = parts[3]?.replace(/^b\//, "") ?? null;
    continue;
  }
  if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@") || line.startsWith("diff ")) {
    continue;
  }
  if (!file) continue;
  if (line.startsWith("+") && !line.startsWith("+++")) {
    const content = line.slice(1);
    filesTouched.add(file);
    if (isCommentLine(content, extOf(file))) {
      if (content.trim()) addedComments++;
    } else {
      violations.push({ file, kind: "non-comment-addition", content });
      modifiedSuspect++;
    }
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    deletedLines++;
    violations.push({ file, kind: "deletion", content: line.slice(1) });
  }
}

console.log(
  JSON.stringify(
    {
      baseline,
      filesTouched: filesTouched.size,
      addedCommentLines: addedComments,
      deletions: deletedLines,
      nonCommentAdditions: modifiedSuspect,
      violationSample: violations.slice(0, 30),
      violationCount: violations.length,
      ok: violations.length === 0,
    },
    null,
    2
  )
);

process.exit(violations.length === 0 ? 0 : 1);
