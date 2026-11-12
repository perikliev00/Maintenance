#!/usr/bin/env node
/**
 * Insert English // comments above uncommented source lines.
 * NEVER modifies existing lines — only inserts new // comment lines.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "c:\\Users\\Admin\\Desktop\\maintenance";

const FILES = [
  "api/src/services/analytics/housekeepingSummary.ts",
  "api/src/services/analytics/forecast.test.ts",
  "api/src/services/analytics/stats.test.ts",
  "api/src/services/analytics/period.test.ts",
  "api/src/services/analytics/period.ts",
  "api/src/services/analytics/maintenanceSummary.ts",
  "api/src/services/analytics/riskRooms.ts",
  "api/src/services/analytics/sessionThresholds.ts",
  "api/src/services/analytics/locationLabel.ts",
  "api/src/services/analytics/forecast.ts",
  "api/src/services/analytics/stats.ts",
  "api/src/services/analytics/index.ts",
  "api/src/services/analytics/types.ts",
  "api/src/services/attendance/rebuild.ts",
  "api/src/services/attendance/notificationOutbox.ts",
  "api/src/services/attendance/adjustments.ts",
  "api/src/services/attendance/stale.test.ts",
  "api/src/services/attendance/reports/csv.test.ts",
  "api/src/services/attendance/reports/pagination.test.ts",
  "api/src/services/attendance/rebuild.test.ts",
  "api/src/services/attendance/index.ts",
  "api/src/services/attendance/reports/map.ts",
  "api/src/services/attendance/reports/query.ts",
  "api/src/services/attendance/reports/pagination.ts",
  "api/src/services/attendance/ingest.ts",
  "api/src/services/attendance/reports/csv.ts",
  "api/src/services/attendance/reports/index.ts",
  "api/src/services/audit.ts",
  "api/src/services/audit.producers.ts",
  "api/src/services/audit.producers.test.ts",
  "api/src/services/audit.write.test.ts",
  "api/src/services/audit.scope.test.ts",
  "api/src/services/authLogin.ts",
  "api/src/services/authProfile.ts",
  "api/src/services/authSessions.ts",
  "api/src/services/authSessions.assert.test.ts",
  "api/src/services/authSessions.rotateRefresh.test.ts",
  "api/src/services/authorization/assigneeBypass.ts",
  "api/src/services/assignees.ts",
  "api/src/services/assignees.test.ts",
  "api/src/services/attendanceRules.ts",
  "api/src/services/attendanceRules.test.ts",
  "api/src/services/cards/index.ts",
  "api/src/services/cards.filter.test.ts",
];

function indentOf(line) {
  return (line.match(/^(\s*)/) || ["", ""])[1];
}
function isEmpty(line) {
  return line.trim() === "";
}
function isPureClosing(line) {
  return /^[\)\]\}]+[;,]?$/.test(line.trim());
}
function isLineComment(line) {
  return /^\s*\/\//.test(line);
}
function isBlockCommentStart(line) {
  return /^\s*\/\*/.test(line);
}
function isBlockCommentEnd(line) {
  return /\*\//.test(line);
}
function isBlockCommentContinuation(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("/*") || t.endsWith("*/");
}
function hasInlineComment(line) {
  let inS = false,
    inD = false,
    inT = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i],
      p = line[i - 1];
    if (!inD && !inT && c === "'" && p !== "\\") inS = !inS;
    else if (!inS && !inT && c === '"' && p !== "\\") inD = !inD;
    else if (!inS && !inD && c === "`" && p !== "\\") inT = !inT;
    else if (!inS && !inD && !inT && c === "/" && line[i + 1] === "/") return true;
  }
  return false;
}
function priorIsAdequateComment(outLines) {
  for (let i = outLines.length - 1; i >= 0; i--) {
    const l = outLines[i];
    if (isEmpty(l)) continue;
    if (isLineComment(l)) return true;
    if (isBlockCommentEnd(l) || isBlockCommentContinuation(l) || isBlockCommentStart(l))
      return true;
    return false;
  }
  return false;
}

/** Lines where a comment adds noise rather than meaning — skip safely. */
function shouldSkipLine(t, ctx) {
  // Closing of a function signature before the body
  if (/^\)\s*(:\s*[^{]+)?\s*\{?\s*$/.test(t)) {
    return { skip: true, reason: "function-signature-closer" };
  }
  // Pure literal call arguments (numbers/strings/bools)
  if (/^(\d+|true|false|null|undefined),?$/.test(t)) {
    return { skip: true, reason: "literal-argument" };
  }
  if (/^["'`]/.test(t) && /["'`],?$/.test(t) && !t.includes(":")) {
    return { skip: true, reason: "string-literal-argument" };
  }
  // Shorthand property `tokens,` or `tokens`
  if (/^[A-Za-z_$][\w$]*,$/.test(t) && !ctx.inExportList) {
    return { skip: true, reason: "shorthand-property" };
  }
  // Type-only parameter noise already covered by function doc — still comment params meaningfully below
  return { skip: false };
}

function commentFor(line, ctx) {
  const ind = indentOf(line);
  const t = line.trim();

  if (/^import\s+type\s+/.test(t)) {
    const m = t.match(/from\s+["']([^"']+)["']/);
    return `${ind}// Type-only import${m ? ` from ${m[1]}` : ""} (erased at runtime).`;
  }
  if (/^import\s+/.test(t)) {
    if (t.includes("node:assert")) return `${ind}// Strict assert helpers for precise test failures.`;
    if (t.includes("node:test")) return `${ind}// Node test runner (describe/it/hooks).`;
    if (t.includes("@prisma/client")) return `${ind}// Prisma client enums and input types.`;
    if (/from\s+["']\.\.\/.*db["']/.test(t) || /from\s+["']\.\.\/\.\.\/db["']/.test(t))
      return `${ind}// Shared Prisma client singleton.`;
    if (t.includes("bcrypt")) return `${ind}// bcrypt for password verify/hash.`;
    const m = t.match(/from\s+["']([^"']+)["']/);
    if (m) return `${ind}// Runtime import from ${m[1]}.`;
    return `${ind}// Module import required below.`;
  }

  if (/^export\s+type\s*\{/.test(t)) return `${ind}// Re-export types from this barrel.`;
  if (/^export\s*\{/.test(t)) return `${ind}// Re-export symbols for a stable public API.`;
  if (/^export\s+\*\s+from/.test(t)) return `${ind}// Re-export entire module through this entry.`;
  {
    const m = t.match(/^export\s+type\s+(\w+)/);
    if (m) return `${ind}// Public type ${m[1]} for callers of this service.`;
  }
  {
    const m = t.match(/^export\s+const\s+(\w+)/);
    if (m) return `${ind}// Exported constant ${m[1]}.`;
  }
  {
    const m = t.match(/^export\s+async\s+function\s+(\w+)/);
    if (m) return `${ind}// Async entry ${m[1]} — IO + domain result.`;
  }
  {
    const m = t.match(/^export\s+function\s+(\w+)/);
    if (m) return `${ind}// Exported helper ${m[1]}.`;
  }
  {
    const m = t.match(/^async\s+function\s+(\w+)/);
    if (m) return `${ind}// Internal async helper ${m[1]}.`;
  }
  {
    const m = t.match(/^function\s+(\w+)/);
    if (m) return `${ind}// Internal helper ${m[1]}.`;
  }

  {
    const m = t.match(/^describe\s*\(\s*["'`]([^"'`]+)/);
    if (m) return `${ind}// Test suite: ${m[1]}.`;
    if (/^describe\s*\(/.test(t)) return `${ind}// Group related test cases.`;
  }
  {
    const m = t.match(/^it\s*\(\s*["'`]([^"'`]+)/);
    if (m) return `${ind}// Test case: ${m[1]}.`;
    if (/^it\s*\(/.test(t)) return `${ind}// Single behavior under test.`;
  }
  if (/^before(?:Each)?\s*\(/.test(t)) return `${ind}// Arrange fixtures before cases.`;
  if (/^after(?:Each)?\s*\(/.test(t)) return `${ind}// Tear down after cases.`;

  if (/^assert\./.test(t)) {
    if (/deepEqual|deepStrictEqual/.test(t)) return `${ind}// Deep-compare structures.`;
    if (/strictEqual|\.equal\(/.test(t)) return `${ind}// Compare scalar values.`;
    if (/\.ok\(|\.truthy\(/.test(t)) return `${ind}// Require truthy condition.`;
    if (/throws|rejects/.test(t)) return `${ind}// Expect an error on this path.`;
    return `${ind}// Assert expected outcome.`;
  }

  if (/^if\s*\(/.test(t)) {
    if (/archivedAt|isActive|activatedAt/.test(t))
      return `${ind}// Block inactive/archived/unactivated accounts.`;
    if (/role\s*===|Role\./.test(t)) return `${ind}// Role-specific behavior.`;
    if (/password|bcrypt|!ok\b/.test(t)) return `${ind}// Reject bad credentials without leaking which check failed.`;
    if (/!/.test(t) && (/null|undefined|\|\|/.test(t)))
      return `${ind}// Guard missing required data.`;
    if (/length|count|threshold|>=|<=/.test(t)) return `${ind}// Threshold/size gate.`;
    if (/status|Status/.test(t)) return `${ind}// Status-based branch.`;
    if (/includes\(/.test(t)) return `${ind}// Membership check before acting.`;
    return `${ind}// Conditional path for this guard.`;
  }
  if (/^else\s+if\s*\(/.test(t)) return `${ind}// Alternate mutually exclusive branch.`;
  if (t === "else" || t === "else {") return `${ind}// Fallback branch.`;
  if (/^for\s+await\s*\(/.test(t)) return `${ind}// Drain async pages/rows.`;
  if (/^for\s*\(\s*const\s+\[/.test(t)) return `${ind}// Iterate key/value pairs.`;
  if (/^for\s*\(\s*const\s+/.test(t)) return `${ind}// Iterate items for aggregation or writes.`;
  if (/^for\s*\(/.test(t)) return `${ind}// Indexed/looped processing.`;
  if (/^while\s*\(/.test(t)) return `${ind}// Loop until stop condition.`;
  if (/^switch\s*\(/.test(t)) return `${ind}// Dispatch on discriminant.`;
  if (/^case\s+/.test(t)) return `${ind}// Handle this case arm.`;
  if (/^default\s*:/.test(t)) return `${ind}// Default switch arm.`;
  if (/^try\s*\{/.test(t)) return `${ind}// Catch locally so callers get mapped errors.`;
  if (/^catch\b/.test(t)) return `${ind}// Handle or remap the failure.`;
  if (/^finally\b/.test(t)) return `${ind}// Cleanup that must always run.`;
  if (/^throw\s+new\s+AppError/.test(t)) return `${ind}// Throw typed AppError for HTTP mapping.`;
  if (/^throw\s+/.test(t)) return `${ind}// Abort with an error.`;
  if (t === "return" || t === "return;") return `${ind}// Early exit.`;
  if (/^return\s+\{/.test(t)) return `${ind}// Return response object.`;
  if (/^return\s+await\s+/.test(t)) return `${ind}// Await then return.`;
  if (/^return\s+/.test(t)) {
    if (/startOfDay|endOfDay|round1|format/.test(t))
      return `${ind}// Return normalized/computed value.`;
    if (/role\s*===/.test(t) || /\|\|/.test(t))
      return `${ind}// Return boolean decision for the caller.`;
    return `${ind}// Return computed result.`;
  }
  if (/^continue\b/.test(t)) return `${ind}// Continue with next iteration.`;
  if (/^break\b/.test(t)) return `${ind}// Break out of loop/switch.`;

  // Boolean OR/AND chain continuations (role checks etc.)
  if (/\|\|\s*$/.test(t) || /&&\s*$/.test(t)) {
    if (/Role\.\w+/.test(t)) {
      const role = t.match(/Role\.(\w+)/)?.[1];
      return `${ind}// Allow ${role} to match this privilege check.`;
    }
    return `${ind}// Additional clause in this boolean decision.`;
  }
  if (/^\w+\s*===\s*Role\.\w+\s*$/.test(t) || /^role\s*===\s*Role\.\w+\s*$/.test(t)) {
    const role = t.match(/Role\.(\w+)/)?.[1];
    return `${ind}// Final allowed role: ${role}.`;
  }

  // Declarations
  if (/^(const|let|var)\s+\[/.test(t)) {
    if (/Promise\.all/.test(t)) return `${ind}// Unpack parallel query results.`;
    return `${ind}// Destructure positional values.`;
  }
  if (/^(const|let|var)\s+\{/.test(t)) return `${ind}// Destructure needed fields only.`;
  {
    const m = t.match(/^(const|let|var)\s+(\w+)/);
    if (m) {
      const name = m[2];
      if (/await\s+prisma\..*findMany/.test(t)) return `${ind}// Load ${name} rows for this window/scope.`;
      if (/await\s+prisma\..*findUnique|await\s+prisma\..*findFirst/.test(t))
        return `${ind}// Fetch ${name} by unique/first match.`;
      if (/await\s+prisma\..*count/.test(t)) return `${ind}// Count rows into ${name}.`;
      if (/await\s+prisma\..*create/.test(t)) return `${ind}// Create row and keep as ${name}.`;
      if (/await\s+prisma\..*update/.test(t)) return `${ind}// Update row into ${name}.`;
      if (/await\s+bcrypt\./.test(t)) return `${ind}// ${name}: password compare result.`;
      if (/await\s+createSession|await\s+publicUser/.test(t))
        return `${ind}// Build ${name} for the login response.`;
      if (/await\s+/.test(t)) return `${ind}// Await ${name} before dependent work.`;
      if (/new\s+Map/.test(t)) return `${ind}// Map ${name} for keyed aggregation.`;
      if (/new\s+Set/.test(t)) return `${ind}// Set ${name} for dedupe/membership.`;
      if (/new\s+Date/.test(t)) return `${ind}// Date ${name} for window math.`;
      if (/=\s*\[\]/.test(t)) return `${ind}// Accumulator list ${name}.`;
      if (/=\s*\{\}/.test(t)) return `${ind}// Accumulator object ${name}.`;
      if (/=\s*0\b/.test(t)) return `${ind}// Counter ${name} starts at 0.`;
      if (/=\s*null\b/.test(t)) return `${ind}// Nullable ${name} until resolved.`;
      if (/=\s*(true|false)\b/.test(t)) return `${ind}// Flag ${name}.`;
      if (/\.filter\(/.test(t)) return `${ind}// ${name}: filtered subset.`;
      if (/\.map\(/.test(t)) return `${ind}// ${name}: projected collection.`;
      if (/\.sort\(/.test(t)) return `${ind}// ${name}: sorted for stable output.`;
      if (/\.reduce\(/.test(t)) return `${ind}// ${name}: reduced aggregate.`;
      if (/\/\s*\w+|Math\.|DAY_MS|FORECAST/.test(t)) return `${ind}// Derived metric ${name}.`;
      return `${ind}// Local ${name} used below.`;
    }
  }

  if (/^await\s+prisma\./.test(t)) {
    if (/update/.test(t)) return `${ind}// Persist field updates.`;
    if (/create/.test(t)) return `${ind}// Insert required row(s).`;
    if (/delete/.test(t)) return `${ind}// Delete obsolete row(s).`;
    return `${ind}// Prisma side effect for this step.`;
  }
  if (/^await\s+/.test(t)) return `${ind}// Await side effect before continuing.`;

  if (/^where\s*:/.test(t)) return `${ind}// Filter matching rows.`;
  if (/^select\s*:/.test(t)) return `${ind}// Select only needed columns.`;
  if (/^include\s*:/.test(t)) return `${ind}// Include relations for labels/checks.`;
  if (/^data\s*:/.test(t)) return `${ind}// Mutation data payload.`;
  if (/^orderBy\s*:/.test(t)) return `${ind}// Stable sort for paging.`;
  if (/^take\s*:/.test(t)) return `${ind}// Page size limit.`;
  if (/^skip\s*:/.test(t)) return `${ind}// Page offset.`;

  // Function parameters: name: Type
  if (ctx.inParamList && /^(\w+)\??\s*:/.test(t)) {
    const name = RegExp.$1;
    return `${ind}// Param ${name} required by this function.`;
  }

  // Object / type fields
  if (/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/.test(t)) {
    const key = RegExp.$1;
    if (ctx.inExportList) return `${ind}// Export ${key}.`;
    if (ctx.inTypeOrObject) {
      if (/userAgent|ip\b/.test(key)) return `${ind}// Optional client metadata: ${key}.`;
      if (/email|password/.test(key)) return `${ind}// Credential field ${key}.`;
      if (/Date|At\b|from|to|now/.test(t + key)) return `${ind}// Time field ${key}.`;
      if (/\?/.test(t.split(":")[0])) return `${ind}// Optional ${key}.`;
      return `${ind}// Field ${key} on this type/payload.`;
    }
    if (/^\w+\s*:\s*(true|false)\b/.test(t)) return `${ind}// Set ${key} flag.`;
    if (/round1\(|format|Date|new /.test(t)) return `${ind}// Compute ${key} for the payload.`;
    return `${ind}// Set ${key}.`;
  }

  if (ctx.inExportList && /^type\s+(\w+),?\s*$/.test(t)) return `${ind}// Export type ${RegExp.$1}.`;
  if (ctx.inExportList && /^[A-Za-z_$][\w$]*,?\s*$/.test(t))
    return `${ind}// Export ${t.replace(/,$/, "")}.`;
  if (/^from\s+["']/.test(t)) {
    const m = t.match(/["']([^"']+)["']/);
    return `${ind}// From module ${m ? m[1] : ""}.`;
  }

  {
    const m = t.match(/^type\s+(\w+)/);
    if (m) return `${ind}// Type alias ${m[1]}.`;
  }
  {
    const m = t.match(/^interface\s+(\w+)/);
    if (m) return `${ind}// Interface ${m[1]}.`;
  }
  {
    const m = t.match(/^enum\s+(\w+)/);
    if (m) return `${ind}// Enum ${m[1]}.`;
  }

  if (/^\.\.\./.test(t)) return `${ind}// Spread additional fields/filters.`;
  if (/^\./.test(t)) {
    if (/\.map\(/.test(t)) return `${ind}// Map elements to output shape.`;
    if (/\.filter\(/.test(t)) return `${ind}// Filter with predicate.`;
    if (/\.sort\(/.test(t)) return `${ind}// Sort for stable order.`;
    if (/\.reduce\(/.test(t)) return `${ind}// Reduce to aggregate.`;
    return `${ind}// Continue fluent chain.`;
  }

  if (/Promise\.all/.test(t)) return `${ind}// Run independent async work in parallel.`;
  if (/prisma\./.test(t)) return `${ind}// Database access for this step.`;

  {
    const m = t.match(/^([A-Za-z_$][\w$]*)\(/);
    if (m) return `${ind}// Invoke ${m[1]}.`;
  }

  if (/^\w+(\.\w+|\[\w+\])*\s*[+\-*/]?=/.test(t)) {
    const lhs = t.split("=")[0].trim();
    return `${ind}// Assign ${lhs}.`;
  }

  // new Date(...) as sole expression argument
  if (/^new\s+Date\(/.test(t)) return `${ind}// Construct Date for the lookback/window bound.`;

  return `${ind}// Support the surrounding control flow.`;
}

function updateCtxFromLine(t, ctx) {
  if (/^export\s*\{/.test(t) || /^export\s+type\s*\{/.test(t)) ctx.inExportList = true;
  if (/^export\s+(async\s+)?function\b/.test(t) || /^(async\s+)?function\b/.test(t)) {
    ctx.inParamList = true;
  }
  if (/^\)\s*(:\s*[^{]+)?\s*\{/.test(t) || /^\)\s*\{/.test(t)) {
    ctx.inParamList = false;
  }
  // Heuristic: line ending with `{` after `=` or `:` opens object/type
  if (/\btype\s+\w+[^=]*=\s*\{/.test(t) || /\binterface\s+\w+/.test(t) || /=\s*\{\s*$/.test(t) || /:\s*\{\s*$/.test(t)) {
    ctx.inTypeOrObject = true;
  }
  if (t === "}" || t === "};" || t === "},") {
    ctx.inTypeOrObject = false;
    ctx.inExportList = false;
  }
}

function processFile(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  const raw = fs.readFileSync(abs, "utf8");
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailing = /\r?\n$/.test(raw);
  const lines = raw.split(/\r?\n/);
  if (hadTrailing && lines[lines.length - 1] === "") lines.pop();

  const out = [];
  let inBlock = false;
  let commentsAdded = 0;
  let modified = false;
  const skipReasons = [];
  const ctx = { inTypeOrObject: false, inExportList: false, inParamList: false };

  for (const line of lines) {
    const t = line.trim();

    if (inBlock) {
      out.push(line);
      if (isBlockCommentEnd(line)) inBlock = false;
      continue;
    }
    if (isBlockCommentStart(line) && !isLineComment(line)) {
      out.push(line);
      if (!isBlockCommentEnd(line)) inBlock = true;
      continue;
    }

    if (isLineComment(line) || isEmpty(line) || isPureClosing(line)) {
      if (isPureClosing(line) && t.startsWith("}")) {
        ctx.inTypeOrObject = false;
        ctx.inExportList = false;
      }
      out.push(line);
      continue;
    }

    updateCtxFromLine(t, ctx);

    if (priorIsAdequateComment(out) || hasInlineComment(line)) {
      out.push(line);
      continue;
    }

    const sk = shouldSkipLine(t, ctx);
    if (sk.skip) {
      skipReasons.push({ file: rel, lineHint: t.slice(0, 80), reason: sk.reason });
      out.push(line);
      continue;
    }

    if (t.startsWith("#!")) {
      out.push(line);
      continue;
    }

    out.push(commentFor(line, ctx));
    out.push(line);
    commentsAdded++;
    modified = true;
  }

  let result = out.join(nl);
  if (hadTrailing) result += nl;

  // Integrity check
  let oi = 0;
  const outLines = result.split(/\r?\n/);
  if (hadTrailing && outLines[outLines.length - 1] === "") outLines.pop();
  for (const orig of lines) {
    while (oi < outLines.length && outLines[oi] !== orig) {
      if (!isLineComment(outLines[oi])) {
        throw new Error(
          `Integrity fail in ${rel}: expected ${JSON.stringify(orig)}, saw ${JSON.stringify(outLines[oi])}`,
        );
      }
      oi++;
    }
    if (oi >= outLines.length || outLines[oi] !== orig) {
      throw new Error(`Integrity fail in ${rel}: missing ${JSON.stringify(orig)}`);
    }
    oi++;
  }

  if (modified) fs.writeFileSync(abs, result, "utf8");
  return { commentsAdded, modified, skipReasons };
}

const report = {
  batch: "api-services-a",
  filesInspected: 0,
  filesModified: 0,
  commentsAdded: 0,
  linesSkippedForSafety: 0,
  skipReasons: [],
  errors: [],
};

for (const rel of FILES) {
  report.filesInspected++;
  try {
    const r = processFile(rel);
    report.commentsAdded += r.commentsAdded;
    if (r.modified) report.filesModified++;
    report.linesSkippedForSafety += r.skipReasons.length;
    // Keep skipReasons capped for report size
    for (const s of r.skipReasons) {
      if (report.skipReasons.length < 200) report.skipReasons.push(s);
    }
  } catch (e) {
    report.errors.push({ file: rel, message: String(e && e.message ? e.message : e) });
  }
}

const outPath = path.join(ROOT, ".comment-batches", "reports", "api-services-a.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
