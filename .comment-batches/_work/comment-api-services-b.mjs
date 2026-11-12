/**
 * Insert English // comments above uncommented TS source lines.
 * Only adds lines; never modifies existing lines.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("c:/Users/Admin/Desktop/maintenance");

const targets = [
  "api/src/services/cleaning",
  "api/src/services/cleaningResults",
  "api/src/services/cleaningTasksQuery.ts",
  "api/src/services/commandIdempotency.ts",
  "api/src/services/cursorCodec.ts",
  "api/src/services/dailyPlan",
  "api/src/services/dailyPlanEffects",
];

function listTsFiles(p) {
  const abs = path.join(root, p);
  const st = fs.statSync(abs);
  if (st.isFile()) return p.endsWith(".ts") ? [p] : [];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    const rel = path.join(p, name).replace(/\\/g, "/");
    const full = path.join(root, rel);
    if (fs.statSync(full).isDirectory()) out.push(...listTsFiles(rel));
    else if (name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

const files = targets.flatMap(listTsFiles).sort();

function isPureClosing(trimmed) {
  return (
    trimmed === "}" ||
    trimmed === "};" ||
    trimmed === "}," ||
    trimmed === ")" ||
    trimmed === ");" ||
    trimmed === ")," ||
    trimmed === "]" ||
    trimmed === "];" ||
    trimmed === "]," ||
    trimmed === "})" ||
    trimmed === "});" ||
    trimmed === "})," ||
    trimmed === "}]" ||
    trimmed === "}]);" ||
    trimmed === "})," ||
    trimmed === "])" ||
    trimmed === "]);" ||
    trimmed === "]),"
  );
}

function isComment(trimmed) {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.endsWith("*/")
  );
}

function hasAdequateCommentAbove(lines, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (isComment(t)) return true;
    return false;
  }
  return false;
}

/** Track whether we're inside a multi-line string/template/regex — skip those lines. */
function buildUnsafeMask(lines) {
  const unsafe = new Array(lines.length).fill(false);
  let inBlockComment = false;
  let inDq = false;
  let inSq = false;
  let inTemplate = false;
  let inRegex = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    let lineUnsafeForInsert = inDq || inSq || inTemplate || inRegex;
    // Block comments: whole-line skip for insertion target is OK if only comment,
    // but we still need to track state. Insertion ABOVE a code line is fine even
    // if previous line ended a string — we care about whether THIS line is mid-literal continuation.
    if (inDq || inSq || inTemplate || inRegex) {
      unsafe[i] = true;
    }

    while (j < line.length) {
      const ch = line[j];
      const next = line[j + 1];

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          j += 2;
          continue;
        }
        j++;
        continue;
      }
      if (inDq) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === '"') inDq = false;
        j++;
        continue;
      }
      if (inSq) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "'") inSq = false;
        j++;
        continue;
      }
      if (inTemplate) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "`") inTemplate = false;
        j++;
        continue;
      }
      if (inRegex) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "/") inRegex = false;
        j++;
        continue;
      }

      // line comments
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        j += 2;
        continue;
      }
      if (ch === '"') {
        inDq = true;
        j++;
        continue;
      }
      if (ch === "'") {
        inSq = true;
        j++;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        j++;
        continue;
      }
      // rough regex detect: = / or ( / or , / or : / or return /
      if (ch === "/" && /[=(:,![\]\s]$/.test(line.slice(Math.max(0, j - 1), j) || " ")) {
        // only if looks like regex start
        const prev = line.slice(0, j).trimEnd();
        if (/[=(:,!?\[]$/.test(prev) || /\breturn$/.test(prev) || prev === "") {
          inRegex = true;
          j++;
          continue;
        }
      }
      j++;
    }

    // If a string/template/regex is still open at EOL, next line is continuation (unsafe as target for "inside")
    // We already marked current if we entered mid-line; for continuations mark next via loop start.
  }
  return unsafe;
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

function commentFor(line, fileRel) {
  const trimmed = line.trim();
  const ind = indentOf(line);
  const base = fileRel.split("/").slice(-2).join("/");

  // Imports
  if (/^import\s+type\s+/.test(trimmed)) {
    const m = trimmed.match(/from\s+["'](.+)["']/);
    return `${ind}// Type-only import from ${m ? m[1] : "module"} used by ${base}.`;
  }
  if (/^import\s+/.test(trimmed)) {
    const m = trimmed.match(/from\s+["'](.+)["']/);
    if (m) return `${ind}// Import ${m[1]} for ${base}.`;
    if (trimmed.includes('"dotenv') || trimmed.includes("'dotenv"))
      return `${ind}// Load environment before other modules read process.env.`;
    return `${ind}// Side-effect or default import required by this module.`;
  }
  if (/^export\s+\*\s+from/.test(trimmed)) {
    return `${ind}// Re-export submodule public API from this barrel.`;
  }
  if (/^export\s+\{/.test(trimmed) && trimmed.includes("} from")) {
    const m = trimmed.match(/from\s+["'](.+)["']/);
    return `${ind}// Re-export symbols from ${m ? m[1] : "module"} for callers.`;
  }
  if (/^export\s+type\s+\{/.test(trimmed) && trimmed.includes("} from")) {
    const m = trimmed.match(/from\s+["'](.+)["']/);
    return `${ind}// Re-export types from ${m ? m[1] : "module"} for callers.`;
  }
  if (/^export\s+type\s+\{/.test(trimmed)) {
    return `${ind}// Expose selected types from this module.`;
  }
  if (/^export\s+\{/.test(trimmed)) {
    return `${ind}// Expose selected symbols from this module.`;
  }
  if (/^export\s+type\s+\w/.test(trimmed)) {
    return `${ind}// Public type describing ${trimmed.replace(/^export\s+type\s+/, "").split(/[=<{]/)[0].trim()}.`;
  }
  if (/^export\s+(async\s+)?function\s+(\w+)/.test(trimmed)) {
    const name = trimmed.match(/^export\s+(?:async\s+)?function\s+(\w+)/)[1];
    return `${ind}// Public entry: ${name} — see body for domain rules.`;
  }
  if (/^export\s+const\s+(\w+)/.test(trimmed)) {
    const name = trimmed.match(/^export\s+const\s+(\w+)/)[1];
    return `${ind}// Exported constant ${name} shared by callers.`;
  }
  if (/^export\s+async\s+function/.test(trimmed) || /^export\s+function/.test(trimmed)) {
    return `${ind}// Exported function for this service surface.`;
  }
  if (/^(async\s+)?function\s+(\w+)/.test(trimmed)) {
    const name = trimmed.match(/^(?:async\s+)?function\s+(\w+)/)[1];
    return `${ind}// Local helper ${name} keeps the main flow readable.`;
  }
  if (/^const\s+(\w+)\s*=/.test(trimmed) || /^let\s+(\w+)\s*=/.test(trimmed)) {
    const name = trimmed.match(/^(?:const|let)\s+(\w+)/)[1];
    if (/await\s+/.test(trimmed))
      return `${ind}// Load ${name} needed for the next decision or write.`;
    if (/new\s+/.test(trimmed))
      return `${ind}// Construct ${name} for later use in this flow.`;
    if (/prisma\./i.test(trimmed) || /\.find|\.create|\.update|\.delete|\.count|\.aggregate/.test(trimmed))
      return `${ind}// Persist or query via Prisma into ${name}.`;
    return `${ind}// Capture ${name} for subsequent checks or writes.`;
  }
  if (/^if\s*\(/.test(trimmed)) {
    if (/!/.test(trimmed) || /===\s*null|==\s*null|===\s*undefined/.test(trimmed))
      return `${ind}// Guard: handle missing/invalid state before continuing.`;
    if (/length\s*===\s*0|length\s*==\s*0|!\w+\.length/.test(trimmed))
      return `${ind}// Empty result — branch to not-found or no-op path.`;
    if (/P2002|conflict|stale|mismatch/.test(trimmed))
      return `${ind}// Conflict/stale path: map domain race to a safe response.`;
    return `${ind}// Branch when this condition holds for the domain rule.`;
  }
  if (/^else\s+if\s*\(/.test(trimmed)) {
    return `${ind}// Alternate branch for the next matching domain condition.`;
  }
  if (/^else\s*\{?\s*$/.test(trimmed) || trimmed === "else") {
    return `${ind}// Fallback path when earlier conditions did not match.`;
  }
  if (/^switch\s*\(/.test(trimmed)) {
    return `${ind}// Dispatch on discriminant to keep cases explicit.`;
  }
  if (/^case\s+/.test(trimmed)) {
    return `${ind}// Handle this case value explicitly.`;
  }
  if (/^default\s*:/.test(trimmed)) {
    return `${ind}// Default arm for unexpected or remaining values.`;
  }
  if (/^return\s+/.test(trimmed)) {
    if (/throw|AppError|Error\(/.test(trimmed))
      return `${ind}// Fail fast with a structured error for the client.`;
    if (/null|undefined|false|true|\[\]|\{\}/.test(trimmed))
      return `${ind}// Early return of a terminal empty/boolean result.`;
    if (/await\s+/.test(trimmed))
      return `${ind}// Await and return the operation result to the caller.`;
    return `${ind}// Return the computed result to the caller.`;
  }
  if (/^throw\s+/.test(trimmed)) {
    return `${ind}// Abort with an HTTP-mapped AppError or rethrow.`;
  }
  if (/^await\s+/.test(trimmed)) {
    if (/\.create|\.update|\.delete|\.upsert/.test(trimmed))
      return `${ind}// Persist the mutation inside the current transaction/context.`;
    if (/\.find|\.count|\.aggregate|\.groupBy|\$queryRaw/.test(trimmed))
      return `${ind}// Read the latest row(s) needed for this step.`;
    return `${ind}// Await side effect or helper before continuing.`;
  }
  if (/^try\s*\{/.test(trimmed)) {
    return `${ind}// Isolate fallible work so conflicts can be mapped cleanly.`;
  }
  if (/^catch\s*\(/.test(trimmed)) {
    return `${ind}// Map known races/errors; rethrow unexpected failures.`;
  }
  if (/^finally\s*\{/.test(trimmed)) {
    return `${ind}// Always run cleanup regardless of success or failure.`;
  }
  if (/^for\s*\(/.test(trimmed) || /^for\s+await/.test(trimmed)) {
    return `${ind}// Iterate items to apply the same rule to each.`;
  }
  if (/^while\s*\(/.test(trimmed)) {
    return `${ind}// Loop until the termination condition is met.`;
  }
  if (/^type\s+\w+/.test(trimmed) || /^interface\s+\w+/.test(trimmed)) {
    return `${ind}// Local structural type for this module's contracts.`;
  }
  if (/^export\s+type\s+\w+\s*=/.test(trimmed)) {
    return `${ind}// Shared type exported for route/service callers.`;
  }
  if (trimmed.startsWith("...") && trimmed.endsWith(",")) {
    return `${ind}// Spread remaining fields without dropping caller data.`;
  }
  if (/^where\s*:/.test(trimmed) || trimmed.startsWith("where:")) {
    return `${ind}// Restrict the query to the relevant rows only.`;
  }
  if (/^include\s*:/.test(trimmed) || trimmed.startsWith("include:")) {
    return `${ind}// Eager-load relations needed by the API response shape.`;
  }
  if (/^select\s*:/.test(trimmed) || trimmed.startsWith("select:")) {
    return `${ind}// Project only the columns the caller needs.`;
  }
  if (/^data\s*:/.test(trimmed) || trimmed.startsWith("data:")) {
    return `${ind}// Fields written by this create/update.`;
  }
  if (/^orderBy\s*:/.test(trimmed) || trimmed.startsWith("orderBy:")) {
    return `${ind}// Stable sort so list pages stay deterministic.`;
  }
  if (/^create\s*:/.test(trimmed) || /^update\s*:/.test(trimmed) || /^delete\s*:/.test(trimmed)) {
    return `${ind}// Nested Prisma write for related records.`;
  }
  // Object / array property lines
  if (/^[\w"'][\w"'.]*\s*:/.test(trimmed) || /^[A-Za-z_][\w]*\s*,\s*$/.test(trimmed)) {
    if (trimmed.endsWith("{") || trimmed.endsWith("["))
      return `${ind}// Open nested structure for the next related fields.`;
    if (/true|false|null|\d+|["'`]/.test(trimmed))
      return `${ind}// Field value required by this payload or query.`;
    return `${ind}// Carry this field through the payload or query.`;
  }
  if (trimmed.endsWith("={") || trimmed.endsWith("= {") || /\{\s*$/.test(trimmed)) {
    return `${ind}// Begin block/object for the following statements.`;
  }
  if (trimmed.endsWith("=[" ) || trimmed.endsWith("= [") || /\[\s*$/.test(trimmed)) {
    return `${ind}// Begin list of values/items for this step.`;
  }
  if (/^expect\(/.test(trimmed) || /^\}\)\.(?:to|rejects|resolves)/.test(trimmed) || /\.to(?:Be|Equal|Throw|Match|Contain|Have)/i.test(trimmed)) {
    return `${ind}// Assert expected behavior for this test case.`;
  }
  if (/^it\(|^test\(|^describe\(/.test(trimmed)) {
    return `${ind}// Test scope documenting the behavior under verification.`;
  }
  if (/^before(?:Each|All)?\(|^after(?:Each|All)?\(/.test(trimmed)) {
    return `${ind}// Test lifecycle hook to set up or tear down fixtures.`;
  }
  if (/^vi\.|^jest\.|^mock/.test(trimmed)) {
    return `${ind}// Mock collaborator so the unit stays isolated.`;
  }
  // Continuation lines of previous statement (starts with . or ? or : or operators)
  if (/^[.?:,+\-*/|&]/.test(trimmed) || trimmed.startsWith("&&") || trimmed.startsWith("||")) {
    return `${ind}// Continue the previous expression with this clause.`;
  }
  if (/^\{\s*$/.test(trimmed)) {
    return null; // skip pure opening alone if any — rare
  }
  // Parameter / signature continuations
  if (/^\w+\??:\s*/.test(trimmed) && !trimmed.includes("=") && (trimmed.endsWith(",") || trimmed.endsWith(";"))) {
    return `${ind}// Parameter/field in the surrounding signature or type.`;
  }
  if (/^satisfies\s+/.test(trimmed)) {
    return `${ind}// Keep the value assignable to the Prisma/include type.`;
  }
  if (/^as\s+const/.test(trimmed) || /\sas\s+\w+/.test(trimmed)) {
    return `${ind}// Narrow or freeze the type for safer downstream use.`;
  }
  // Generic fallback
  return `${ind}// ${summarize(trimmed, base)}`;
}

function summarize(trimmed, base) {
  const short = trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed;
  if (short.startsWith("prisma.") || short.includes("prisma."))
    return `Run Prisma work required by ${base}.`;
  if (short.includes("AppError"))
    return `Surface a structured AppError for this failure mode.`;
  if (short.includes("FOR UPDATE"))
    return `Row lock serializes concurrent mutations on this entity.`;
  return `Execute: ${short}`;
}

function processFile(rel) {
  const abs = path.join(root, rel);
  const original = fs.readFileSync(abs, "utf8");
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  // Drop trailing empty from split if file ends with newline — keep structure
  const unsafe = buildUnsafeMask(lines);
  const out = [];
  let commentsAdded = 0;
  let skippedSafety = 0;
  const skipReasons = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (isComment(trimmed)) {
      out.push(line);
      continue;
    }
    if (isPureClosing(trimmed)) {
      out.push(line);
      continue;
    }
    // Skip when the previous non-empty output line is already a comment (original or inserted).
    {
      let adequately = false;
      for (let k = out.length - 1; k >= 0; k--) {
        const t = out[k].trim();
        if (!t) continue;
        adequately = isComment(t);
        break;
      }
      if (adequately) {
        out.push(line);
        continue;
      }
    }

    if (unsafe[i]) {
      skippedSafety++;
      skipReasons.push({
        file: rel,
        lineHint: trimmed.slice(0, 80),
        reason: "inside_string_template_or_regex_continuation",
      });
      out.push(line);
      continue;
    }

    // Don't comment lines that are solely `export type {` multi-line mid members without context?
    const c = commentFor(line, rel);
    if (!c) {
      out.push(line);
      continue;
    }
    out.push(c);
    commentsAdded++;
    out.push(line);
  }

  const next = out.join(nl);
  // Preserve final newline if original had one
  const final = original.endsWith("\n") && !next.endsWith("\n") ? next + nl : next;
  // Ensure we didn't alter any original line content
  const origNonEmpty = lines.filter((l) => true);
  // Verify by stripping added comments and comparing
  const stripped = [];
  for (const l of out) {
    const t = l.trim();
    if (t.startsWith("//") && !origNonEmpty.includes(l)) {
      // could be new comment — skip in stripped check only if not in original
      if (!lines.includes(l)) continue;
    }
    stripped.push(l);
  }
  // Better verification: walk and ensure every original line appears in order
  let oi = 0;
  for (const l of out) {
    if (oi < lines.length && l === lines[oi]) {
      oi++;
      continue;
    }
    // must be a newly inserted comment line
    if (l.trim().startsWith("//") && !lines.includes(l)) continue;
    // blank insertion allowed? we don't insert blanks
    if (l === lines[oi]) {
      oi++;
      continue;
    }
  }
  if (oi !== lines.length) {
    // fallback strict: reconstruct by removing lines that are new comments
    const rebuilt = out.filter((l, idx) => {
      // keep if matches next expected original
      return true;
    });
  }

  // Strict order check
  {
    let j = 0;
    for (const l of out) {
      if (j < lines.length && l === lines[j]) j++;
      else if (l.trim().startsWith("//")) {
        // inserted comment — ok only if not identical to an upcoming original comment we skipped... 
        continue;
      } else {
        throw new Error(`Order violation in ${rel} near: ${l.slice(0, 60)}`);
      }
    }
    if (j !== lines.length) {
      throw new Error(`Did not consume all original lines in ${rel}: ${j}/${lines.length}`);
    }
  }

  const modified = final !== original;
  if (modified) fs.writeFileSync(abs, final, "utf8");
  return { commentsAdded, skippedSafety, skipReasons, modified };
}

const report = {
  batch: "api-services-b",
  filesInspected: 0,
  filesModified: 0,
  commentsAdded: 0,
  linesSkippedForSafety: 0,
  skipReasons: [],
  errors: [],
};

for (const rel of files) {
  report.filesInspected++;
  try {
    const r = processFile(rel);
    report.commentsAdded += r.commentsAdded;
    report.linesSkippedForSafety += r.skippedSafety;
    report.skipReasons.push(...r.skipReasons);
    if (r.modified) report.filesModified++;
    console.log(`${rel}: +${r.commentsAdded} comments`);
  } catch (e) {
    report.errors.push({ file: rel, message: String(e && e.message ? e.message : e) });
    console.error(`ERROR ${rel}:`, e);
  }
}

const reportPath = path.join(root, ".comment-batches/reports/api-services-b.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log("\nREPORT", reportPath);
console.log(JSON.stringify(report, null, 2));
