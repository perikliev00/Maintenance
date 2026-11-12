#!/usr/bin/env node
/** Verify working-tree diff vs HEAD only deletes comment/blank lines and does not add non-comments. */
import { execSync } from "node:child_process";

function isCommentOrBlank(line, file) {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/")) return true;
  if (file.endsWith(".sh") || file.endsWith(".ps1")) return t.startsWith("#");
  if (file.endsWith(".sql")) return t.startsWith("--") || t.startsWith("/*");
  return false;
}

const raw = execSync("git diff -U0 HEAD", { encoding: "utf8", maxBuffer: 80e6 });
let file = null;
const bad = [];
let delComments = 0;
let addNonComments = 0;
let delNonComments = 0;
const files = new Set();

for (const line of raw.split(/\r?\n/)) {
  if (line.startsWith("diff --git ")) {
    file = line.split(" ")[3]?.replace(/^b\//, "") ?? null;
    continue;
  }
  if (!file || line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
  if (line.startsWith("+") && !line.startsWith("+++")) {
    files.add(file);
    const content = line.slice(1);
    if (!isCommentOrBlank(content, file)) {
      addNonComments++;
      if (bad.length < 40) bad.push({ file, kind: "non-comment-addition", content: content.slice(0, 160) });
    }
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    files.add(file);
    const content = line.slice(1);
    if (isCommentOrBlank(content, file)) delComments++;
    else {
      delNonComments++;
      if (bad.length < 40) bad.push({ file, kind: "non-comment-deletion", content: content.slice(0, 160) });
    }
  }
}

console.log(
  JSON.stringify(
    {
      filesTouched: files.size,
      deletedCommentOrBlankLines: delComments,
      deletedNonCommentLines: delNonComments,
      addedNonCommentLines: addNonComments,
      ok: delNonComments === 0 && addNonComments === 0,
      sample: bad,
    },
    null,
    2,
  ),
);
process.exit(delNonComments === 0 && addNonComments === 0 ? 0 : 1);
