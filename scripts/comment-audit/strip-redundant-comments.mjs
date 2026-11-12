#!/usr/bin/env node
/**
 * Remove high-volume AI-generated narration comments while preserving
 * meaningful WHY/invariant comments, JSDoc, and tooling directives.
 *
 * Safety:
 * - Uses TypeScript scanner comment ranges (never touches strings/JSX text).
 * - Verifies non-comment tokens are byte-identical before writing.
 * - Does not modify executable tokens.
 *
 * Usage:
 *   node scripts/comment-audit/strip-redundant-comments.mjs [--dry-run] [--root=api/src]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("../../web/node_modules/typescript");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rootArg = args.find((a) => a.startsWith("--root="));
const onlyRoots = rootArg
  ? [rootArg.slice("--root=".length)]
  : ["api/src", "api/tests", "api/scripts", "api/prisma", "web/src", "e2e", "scripts"];

const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git", "comment-audit"]);

/** Exact / prefix patterns from .comment-batches annotators (category A). */
const EXACT_REMOVE = new Set([
  "Execute the next setup or assertion step for this scenario.",
  "Support the surrounding logic for this step.",
  "Support the surrounding control flow.",
  "Await async work before asserting or releasing locks.",
  "Field/property in this shape.",
  "Assert the observed value matches the intended post-condition.",
  "SQL fragment used to observe locks or assert DB state.",
  "Assert HTTP status matches the contract for this path.",
  "Conditional branch for the case described by this guard.",
  "Return early result or rendered output from this path.",
  "Update React state so the UI reflects the new value.",
  "Assert expected test outcome.",
  "List item in import/export/params.",
  "Seed prerequisite rows so the mutation under test has a realistic baseline.",
  "Local constant binding.",
  "Define a single test case and its expectation.",
  "Assert collection size matches the expected post-condition.",
  "Invoke helper or pass arguments.",
  "Concurrency/isolation step for the race under test.",
  "Wait for an async operation before continuing.",
  "Assert expected behavior in this test case.",
  "Conditional path for setup, cleanup, or alternate outcomes.",
  "Open multi-line construct.",
  "React state slot for local UI/data that can change over time.",
  "Session/CSRF step exercising auth lifecycle.",
  "Import module bindings used by this suite.",
  "Continue multi-line list/arguments.",
  "Try path where partial failure must not leak suite state.",
  "Unit test case.",
  "Return computed result to caller.",
  "Node test runner and strict assertions for API suite checks.",
  "Arrange shared preconditions before cases run.",
  "Assert browser/UI outcome matches the scenario intent.",
  "Arrow function / callback body.",
  "Assert UI visibility/state after the user action.",
  "Drive the browser through the user-visible workflow step.",
  "Wait for the async step before continuing.",
  "Return the arranged value/result to the caller.",
  "Iterate to cover variants or wait until a condition holds.",
  "Continue the call chain for setup or assertion detail.",
  "Local type alias shaping data.",
  "Export type definition for consumers of this module.",
  "Start or stop the in-process API server for this suite.",
  "Disconnect Prisma so the pool does not leak across suites.",
  "Release servers/DB clients so later suites stay isolated.",
  "Assert we are on the isolated test DB, not a seed/prod database.",
  "Await async work before continuing.",
  "Group related tests under a shared suite name.",
  "Arrange or act for this test case.",
  "Assert expected outcome for this case.",
  "Module import required below.",
  "Mutation data payload.",
  "Filter matching rows.",
  "Select only needed columns.",
  "Include relations for labels/checks.",
  "Stable sort for paging.",
  "Page size limit.",
  "Page offset.",
  "Await side effect before continuing.",
  "Prisma side effect for this step.",
  "Persist field updates.",
  "Insert required row(s).",
  "Delete obsolete row(s).",
  "Local binding for this step.",
  "Early exit.",
  "Return response object.",
  "Await then return.",
  "Return computed result.",
  "Continue with next iteration.",
  "Break out of loop/switch.",
  "Additional clause in this boolean decision.",
  "Conditional path for this guard.",
  "Alternate mutually exclusive branch.",
  "Fallback branch.",
  "Drain async pages/rows.",
  "Iterate key/value pairs.",
  "Iterate items for aggregation or writes.",
  "Indexed/looped processing.",
  "Loop until stop condition.",
  "Dispatch on discriminant.",
  "Handle this case arm.",
  "Default switch arm.",
  "Catch locally so callers get mapped errors.",
  "Handle or remap the failure.",
  "Cleanup that must always run.",
  "Throw typed AppError for HTTP mapping.",
  "Abort with an error.",
  "Destructure positional values.",
  "Destructure needed fields only.",
  "Unpack parallel query results.",
  "Render UI node.",
  "Render a <div> element for layout or semantics.",
  "Render a <button> element for layout or semantics.",
  "Render a <span> element for layout or semantics.",
  "Render a <p> element for layout or semantics.",
  "Render a <form> element for layout or semantics.",
  "Render a <input> element for layout or semantics.",
  "Render a <label> element for layout or semantics.",
  "Render a <section> element for layout or semantics.",
  "Render a <header> element for layout or semantics.",
  "Render a <main> element for layout or semantics.",
  "Render a <nav> element for layout or semantics.",
  "Declare a type alias.",
  "Pass className prop/value into the element or config.",
  "Pass onClick prop/value into the element or config.",
  "Pass type prop/value into the element or config.",
  "Single behavior under test.",
  "Group related test cases.",
  "Arrange fixtures before cases.",
  "Tear down after cases.",
  "Deep-compare structures.",
  "Compare scalar values.",
  "Require truthy condition.",
  "Expect an error on this path.",
  "Assert expected outcome.",
  "Re-export types from this barrel.",
  "Re-export symbols for a stable public API.",
  "Re-export entire module through this entry.",
  "Begin guarded block to catch runtime failures.",
  "Bind a local value for the following logic.",
  "Bind received for use in the following logic.",
  "Bind body for use in the following logic.",
  "Bind api for use in the following logic.",
  "Bind address for use in the following logic.",
  "Bind fn for later setup or assertions in this scope.",
  "Bind trg for later setup or assertions in this scope.",
  "Bind escaped for later setup or assertions in this scope.",
  "Bind text for later setup or assertions in this scope.",
  "Bind values for later setup or assertions in this scope.",
  "Bind settled for later setup or assertions in this scope.",
  "Bind msg for later setup or assertions in this scope.",
  "Bind pid for later setup or assertions in this scope.",
  "Provide expectedStatus for the object/call below.",
  "Provide accessVersion for the object/call below.",
  "Pass prisma through.",
  "State transition.",
  "Return value / early exit.",
]);

const PREFIX_REMOVE = [
  /^Param \w+ required by this function\.?$/,
  /^Field \w+ on this type\/payload\.?$/,
  /^Time field \w+\.?$/,
  /^Optional \w+\.?$/,
  /^Optional client metadata: \w+\.?$/,
  /^Credential field \w+\.?$/,
  /^Set \w+ flag\.?$/,
  /^Set \w+ on the structure being built\.?$/,
  /^Export \w+\.?$/,
  /^Exported constant \w+\.?$/,
  /^Exported helper \w+\.?$/,
  /^Async entry \w+ — IO \+ domain result\.?$/,
  /^Internal async helper \w+\.?$/,
  /^Internal helper \w+\.?$/,
  /^Public type \w+ for callers of this service\.?$/,
  /^Runtime import from .+/,
  /^Type-only import( from .+)? \(erased at runtime\)\.?$/,
  /^Import module dependency from .+/,
  /^Test suite: .+/,
  /^Test case: .+/,
  /^Allow \w+ to match this privilege check\.?$/,
  /^Final allowed role: \w+\.?$/,
  /^Local \w+ used below\.?$/,
  /^Await \w+ before dependent work\.?$/,
  /^Load \w+ rows for this window\/scope\.?$/,
  /^Fetch \w+ by unique\/first match\.?$/,
  /^Count rows into \w+\.?$/,
  /^Create row and keep as \w+\.?$/,
  /^Update row into \w+\.?$/,
  /^Map \w+ for keyed aggregation\.?$/,
  /^Set \w+ for dedupe\/membership\.?$/,
  /^Date \w+ for window math\.?$/,
  /^Accumulator list \w+\.?$/,
  /^Accumulator object \w+\.?$/,
  /^Counter \w+ starts at 0\.?$/,
  /^Nullable \w+ until resolved\.?$/,
  /^Flag \w+\.?$/,
  /^\w+: filtered subset\.?$/,
  /^\w+: projected collection\.?$/,
  /^\w+: sorted for stable output\.?$/,
  /^\w+: reduced aggregate\.?$/,
  /^Derived metric \w+\.?$/,
  /^\w+: password compare result\.?$/,
  /^Build \w+ for the login response\.?$/,
  /^Invoke \w+ to perform this step\.?$/,
  /^Pass \w+ prop\/value into the element or config\.?$/,
  /^Render \w+ as part of this view composition\.?$/,
  /^Render a <\w+> element for layout or semantics\.?$/,
  /^Provide \w+ for the object\/call below\.?$/,
  /^Bind \w+ for (use in the following logic|later setup or assertions in this scope)\.?$/,
  /^Capture \w+ for use in this scope\.?$/,
  /^Update \w+ as control flow progresses\.?$/,
  /^Load \w+ asynchronously for the next steps\.?$/,
  /^Run next step: .+/,
  /^Define \w+ as a callable used by this flow\.?$/,
  /^Define \w+ — core behavior for this module\.?$/,
  /^Branch when this condition holds so the right path runs\.?$/,
  /^Attempt the fallible work so errors can be handled below\.?$/,
  /^\w+: synchronize actors so the race window is observable\.?$/,
  /^\w+: unique stamp so parallel runs do not collide\.?$/,
  /^\w+: HTTP response captured for status\/body checks\.?$/,
  /^\w+: credential\/token material for auth flows\.?$/,
  /^Fixture field \w+ for the seeded actor\/entity\.?$/,
  /^Runner option controlling stability or isolation of the suite\.?$/,
  /^Shared Prisma client singleton\.?$/,
  /^Prisma client enums and input types\.?$/,
  /^Strict assert helpers for precise test failures\.?$/,
  /^Node test runner \(describe\/it\/hooks\)\.?$/,
  /^bcrypt for password verify\/hash\.?$/,
  /^Return normalized\/computed value\.?$/,
  /^Return boolean decision for the caller\.?$/,
  /^Threshold\/size gate\.?$/,
  /^Status-based branch\.?$/,
  /^Membership check before acting\.?$/,
  /^Role-specific behavior\.?$/,
  /^Block inactive\/archived\/unactivated accounts\.?$/,
  /^Reject bad credentials without leaking which check failed\.?$/,
  /^Guard missing required data\.?$/,
  /^Configure \w+ for this CI helper run\.?$/,
  /^Advance the P1 test-database preparation step\.?$/,
  /^Conditional branch for this shell guard\.?$/,
  /^Close the if\/elif\/else conditional\.?$/,
  /^Close the loop body\.?$/,
  /^End the case dispatch block\.?$/,
  /^Declare a function-scoped shell variable\.?$/,
  /^Append optional env line when configured\.?$/,
  /^Print status or error guidance for the operator\.?$/,
  /^Exit the script with the indicated status\.?$/,
  /^Define helper function \w+\.?$/,
  /^Dispatch on CLI argument \/ mode value\.?$/,
  /^Iterate arguments or items\.?$/,
];

const PRESERVE_ALWAYS = [
  /^@ts-/,
  /^eslint-/,
  /^oxlint-/,
  /^prettier-/,
  /^istanbul\s/,
  /^c8\s/,
  /^v8\s/,
  /^coveralls/,
  /^TODO\b/i,
  /^FIXME\b/i,
  /^HACK\b/i,
  /^NOTE\b/i,
  /^WARNING\b/i,
  /^IMPORTANT\b/i,
  /^SECURITY\b/i,
  /^SPDX-/,
  /^Copyright\b/i,
  /^Licensed\b/i,
  /^#!/,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) walk(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function normalizeCommentBody(text) {
  let t = text.trim();
  if (t.startsWith("//")) t = t.slice(2).trim();
  else if (t.startsWith("/*")) {
    t = t.replace(/^\/\*/, "").replace(/\*\/$/, "").trim();
    // collapse JSDoc stars for classification only
    t = t
      .split(/\n/)
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
  }
  return t;
}

function shouldPreserve(body) {
  return PRESERVE_ALWAYS.some((re) => re.test(body));
}

function shouldRemove(body) {
  if (!body) return false;
  if (shouldPreserve(body)) return false;
  if (EXACT_REMOVE.has(body)) return true;
  if (PREFIX_REMOVE.some((re) => re.test(body))) return true;
  // Generic annotator leftovers that still read as pure narration.
  if (/^Support the surrounding/.test(body)) return true;
  if (/^Invoke [A-Za-z_.]+ to perform this step\.?$/.test(body)) return true;
  if (/^Pass \w+ (prop\/value|through)\b/.test(body)) return true;
  if (/^Provide \w+ for the object\/call below\.?$/.test(body)) return true;
  if (/^Bind \w+ for /.test(body)) return true;
  if (/^Capture \w+ for use in this scope\.?$/.test(body)) return true;
  if (/^Update \w+ as control flow progresses\.?$/.test(body)) return true;
  if (/^Load \w+ asynchronously for the next steps\.?$/.test(body)) return true;
  if (/^Run next step:/.test(body)) return true;
  if (/^Param \w+ /.test(body)) return true;
  if (/^Field \w+ on this /.test(body)) return true;
  if (/^Local \w+ used below\.?$/.test(body)) return true;
  if (/^Await \w+ before /.test(body)) return true;
  return false;
}

function collectCommentRanges(sf) {
  const ranges = [];
  const seen = new Set();
  function add(list) {
    if (!list) return;
    for (const r of list) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(r);
    }
  }
  // Shebang / leading file comments
  add(ts.getLeadingCommentRanges(sf.text, 0));
  function visit(node) {
    add(ts.getLeadingCommentRanges(sf.text, node.pos));
    add(ts.getTrailingCommentRanges(sf.text, node.end));
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return ranges.sort((a, b) => b.pos - a.pos);
}

function nonCommentFingerprint(text, scriptKind) {
  const sf = ts.createSourceFile(
    "probe" + scriptKindExt(scriptKind),
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  // Printer with comments removed yields executable structure only.
  // Normalize whitespace so deleting whole comment lines does not false-fail.
  const printed = ts
    .createPrinter({
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    })
    .printFile(sf);
  return printed.replace(/\s+/g, " ").trim();
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

function scriptKindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function stripFile(file) {
  const original = fs.readFileSync(file, "utf8");
  const kind = scriptKindFor(file);
  const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, kind);
  const ranges = collectCommentRanges(sf);

  const removals = [];
  for (const r of ranges) {
    const raw = original.slice(r.pos, r.end);
    // Never strip block/JSDoc wholesale unless it's clearly a single-line annotator leftover.
    const isLine = raw.trimStart().startsWith("//");
    if (!isLine) continue; // preserve /* */ and JSDoc entirely for safety
    const body = normalizeCommentBody(raw);
    if (shouldRemove(body)) {
      removals.push(r);
    }
  }

  if (removals.length === 0) {
    return { file, removed: 0, changed: false };
  }

  let next = original;
  for (const r of removals) {
    let start = r.pos;
    let end = r.end;
    // Prefer deleting the whole physical line when the comment occupies it alone.
    // Expand to include preceding indent and following newline when safe.
    const lineStart = next.lastIndexOf("\n", start - 1) + 1;
    const after = next.slice(end);
    const beforeSeg = next.slice(lineStart, start);
    const onlyIndentBefore = /^\s*$/.test(beforeSeg);
    const newlineAfter = after.match(/^\r?\n/);
    if (onlyIndentBefore && newlineAfter) {
      start = lineStart;
      end = end + newlineAfter[0].length;
    } else {
      // trailing comment on a code line: drop the comment and a single preceding space if present
      if (start > 0 && /\s/.test(next[start - 1])) start -= 1;
    }
    next = next.slice(0, start) + next.slice(end);
  }

  // Collapse runs of 3+ blank lines introduced by removals to max 2.
  next = next.replace(/\n{4,}/g, "\n\n\n");

  const beforeFp = nonCommentFingerprint(original, kind);
  const afterFp = nonCommentFingerprint(next, kind);
  if (beforeFp !== afterFp) {
    return {
      file,
      removed: 0,
      changed: false,
      error: "non-comment token fingerprint mismatch; skipped",
    };
  }

  if (!dryRun) fs.writeFileSync(file, next);
  return { file, removed: removals.length, changed: true };
}

const results = [];
let errors = [];
for (const root of onlyRoots) {
  for (const file of walk(root)) {
    try {
      results.push(stripFile(file));
    } catch (e) {
      errors.push({ file, error: String(e && e.stack ? e.stack : e) });
    }
  }
}

const changed = results.filter((r) => r.changed);
const removed = results.reduce((s, r) => s + r.removed, 0);
const skipped = results.filter((r) => r.error);

console.log(
  JSON.stringify(
    {
      dryRun,
      roots: onlyRoots,
      filesScanned: results.length,
      filesModified: changed.length,
      commentRangesRemoved: removed,
      skippedForSafety: skipped.length,
      skipSample: skipped.slice(0, 20),
      errorCount: errors.length,
      errorSample: errors.slice(0, 10),
    },
    null,
    2,
  ),
);
