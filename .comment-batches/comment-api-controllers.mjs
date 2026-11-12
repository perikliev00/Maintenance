/**
 * Insert English // comments above uncommented source lines in api/src/controllers.
 * ONLY inserts new comment lines — never modifies existing lines.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("api/src/controllers");
const REPORT = path.resolve(".comment-batches/reports/api-controllers.json");

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

function isPureClosing(trimmed) {
  // Skip lines that are only brackets/parens/semicolons/commas (e.g. }, });, ],).
  if (/^[})\]]+[;,]*$/.test(trimmed)) return true;
  // Closing brace of a multi-line import: `} from "...";`
  if (/^\} from\s+["'].*["'];?$/.test(trimmed)) return true;
  return false;
}

function isCommentLine(trimmed) {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.endsWith("*/")
  );
}

function hasInlineComment(line) {
  // crude: // outside strings — good enough for skip decisions on asserts etc.
  let inS = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inS) {
      if (c === "\\") escaped = true;
      else if (c === inS) inS = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inS = c;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") return true;
  }
  return false;
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

function summarizeImport(line) {
  const t = line.trim();
  if (t.startsWith("import type ")) {
    const m = t.match(/from\s+["']([^"']+)["']/);
    return m
      ? `Import type-only bindings from ${m[1]}.`
      : "Import type-only bindings used by this module.";
  }
  if (t.startsWith("import ")) {
    const m = t.match(/from\s+["']([^"']+)["']/);
    if (m) {
      const mod = m[1];
      if (mod.startsWith(".")) return `Import local module ${mod}.`;
      return `Import dependency ${mod}.`;
    }
    if (t.includes("{")) return "Continue named import list.";
    return "Import module dependency.";
  }
  return null;
}

function commentFor(line, ctx) {
  const t = line.trim();
  if (!t) return null;
  if (isPureClosing(t)) return null;
  if (isCommentLine(t)) return null;

  const imp = summarizeImport(line);
  if (imp) return imp;

  // Named import symbol inside `{ ... }`
  if (
    ctx.inImportBlock &&
    /^[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?,?$/.test(t)
  ) {
    const name = t.replace(/,$/, "").split(/\s+as\s+/)[0];
    return `Bring ${name} into scope from the import.`;
  }

  if (/^export\s+async\s+function\s+(\w+)/.test(t)) {
    const name = t.match(/^export\s+async\s+function\s+(\w+)/)[1];
    return `HTTP handler ${name} — validate input, call services, respond.`;
  }
  if (/^export\s+function\s+(\w+)/.test(t)) {
    const name = t.match(/^export\s+function\s+(\w+)/)[1];
    return `Exported helper ${name} used by routes or sibling controllers.`;
  }
  if (/^export\s+const\s+\{/.test(t)) {
    return "Destructure and export handlers produced by the kind-specific factory.";
  }
  if (/^export\s+const\s+(\w+)/.test(t)) {
    const name = t.match(/^export\s+const\s+(\w+)/)[1];
    return `Export ${name} for route wiring.`;
  }
  if (/^export\s+\{/.test(t)) return "Re-export public symbols for consumers.";
  if (/^export\s+type\s+/.test(t)) return "Export a shared type alias for callers.";
  if (/^export\s+interface\s+/.test(t)) return "Export an interface describing this shape.";

  if (/^async\s+function\s+(\w+)/.test(t)) {
    const name = t.match(/^async\s+function\s+(\w+)/)[1];
    return `Async helper ${name} keeps handler bodies thin.`;
  }
  if (/^function\s+(\w+)/.test(t)) {
    const name = t.match(/^function\s+(\w+)/)[1];
    return `Local helper ${name} shared by handlers in this file.`;
  }

  if (/^const\s+(\w+)\s*=\s*z\./.test(t) || /^const\s+(\w+)\s*=\s*z$/.test(t)) {
    const name = t.match(/^const\s+(\w+)/)[1];
    return `Zod schema ${name} for request validation.`;
  }
  if (/^const\s+schema\s*=/.test(t))
    return "Define Zod schema for this request payload or query.";
  if (/^const\s+parsed\s*=/.test(t))
    return "Parse and validate input against the schema.";
  if (/^const\s+scope\s*=/.test(t))
    return "Resolve caller's DataScope for Prisma filtering.";
  if (/^const\s+result\s*=/.test(t))
    return "Invoke service and capture the result payload.";
  if (/^const\s+data\s*=/.test(t)) return "Load data from the domain service.";
  if (/^const\s+(\w+)\s*=\s*await\s+/.test(t)) {
    const name = t.match(/^const\s+(\w+)/)[1];
    return `Await async work into ${name}.`;
  }
  if (/^const\s+(\w+)\s*=/.test(t)) {
    const name = t.match(/^const\s+(\w+)/)[1];
    return `Bind ${name} for use in the handler below.`;
  }
  if (/^let\s+(\w+)\s*=/.test(t)) {
    const name = t.match(/^let\s+(\w+)/)[1];
    return `Mutable ${name} updated as the flow proceeds.`;
  }

  if (/^if\s*\(\s*!parsed\.success/.test(t))
    return "Reject malformed input before any side effects.";
  if (/^if\s*\(\s*!/.test(t))
    return "Guard: skip or fail when the negated condition holds.";
  if (/^if\s*\(/.test(t)) return "Branch when this condition holds.";
  if (/^else\s+if\s*\(/.test(t))
    return "Alternate branch for this related condition.";
  if (/^else\s*\{?\s*$/.test(t))
    return "Fallback when prior conditions did not match.";
  if (/^for\s*\(/.test(t)) return "Iterate to process each item.";
  if (/^while\s*\(/.test(t)) return "Loop while the condition remains true.";
  if (/^switch\s*\(/.test(t)) return "Dispatch by discriminant value.";
  if (/^case\s+/.test(t)) return "Handle this specific case.";
  if (/^default\s*:/.test(t)) return "Default when no label matched.";
  if (/^try\s*\{?\s*$/.test(t)) return "Try block for operations that may throw.";
  if (/^catch\s*\(/.test(t)) return "Handle errors thrown in the try block.";
  if (/^finally\s*\{?\s*$/.test(t)) return "Cleanup that always runs after try/catch.";
  if (/^throw\s+/.test(t)) return "Abort with an application/HTTP error.";
  if (/^return\s+res\.status\(409\)/.test(t))
    return "Conflict when resource state blocks the action.";
  if (/^return\s+res\.status\(404\)/.test(t))
    return "Not-found for missing or out-of-scope entity.";
  if (/^return\s+res\.status\(403\)/.test(t))
    return "Forbidden when the caller lacks access.";
  if (/^return\s+res\.status\(401\)/.test(t))
    return "Unauthorized when auth is missing or invalid.";
  if (/^return\s+res\.status\(400\)/.test(t))
    return "Bad-request validation error response.";
  if (/^return\s+res\.status\(201\)/.test(t))
    return "Created response with the new resource body.";
  if (/^return\s+res\.status\(204\)/.test(t))
    return "No-content success response.";
  if (/^return\s+res\.json\(/.test(t))
    return "JSON success response with the payload.";
  if (/^return\s+res\./.test(t))
    return "Send the HTTP response and end the handler.";
  if (/^res\.json\(/.test(t)) return "Write JSON body for a successful response.";
  if (/^res\.status\(/.test(t)) return "Set HTTP status for the outgoing response.";
  if (/^return\s+/.test(t)) return "Return value or early exit.";

  if (/^await\s+/.test(t)) return "Await side-effecting async work.";
  if (/^void\s+/.test(t))
    return "Fire-and-forget; intentionally ignore the promise result.";

  if (/^describe\s*\(/.test(t)) return "Test suite grouping related cases.";
  if (/^it\s*\(/.test(t)) return "Single test case asserting expected behavior.";
  if (/^before(?:Each|All)?\s*\(/.test(t)) return "Setup hook run before tests.";
  if (/^after(?:Each|All)?\s*\(/.test(t)) return "Teardown hook run after tests.";
  if (/^assert\./.test(t)) return "Assert expected outcome for this case.";

  if (/^[A-Za-z_$][\w$]*\s*:\s*z\./.test(t)) {
    const key = t.match(/^([A-Za-z_$][\w$]*)/)[1];
    return `Validate field ${key}.`;
  }
  if (
    /^[A-Za-z_$][\w$]*\s*:/.test(t) &&
    !t.startsWith("http") &&
    !t.includes("=>")
  ) {
    const key = t.match(/^([A-Za-z_$][\w$]*)/)[1];
    return `Provide ${key} for the object/call below.`;
  }

  if (/^\.status\(/.test(t)) return "Set response status code.";
  if (/^\.json\(/.test(t)) return "Attach JSON body to the response.";
  if (/^\.string\(/.test(t)) return "Require a string value in the schema.";
  if (/^\.min\(/.test(t)) return "Enforce minimum length/value constraint.";
  if (/^\.max\(/.test(t)) return "Enforce maximum length/value constraint.";
  if (/^\.optional\(/.test(t)) return "Allow the field to be omitted.";
  if (/^\.refine\(/.test(t)) return "Add a custom refinement check.";
  if (/^\.enum\(/.test(t)) return "Restrict to an allowed enum set.";
  if (/^\.array\(/.test(t)) return "Expect an array of elements.";
  if (/^\.object\(/.test(t)) return "Expect a nested object shape.";
  if (/^\.uuid\(/.test(t)) return "Require UUID format.";
  if (/^\.default\(/.test(t)) return "Supply a default when the field is missing.";
  if (/^\.safeParse\(/.test(t) || /^\}\)(\.)?safeParse\(/.test(t) || /^\}\.safeParse\(/.test(t))
    return "Run safeParse so validation failures stay typed.";
  if (/^\.\w+\(/.test(t) || /^\.\w+$/.test(t))
    return "Continue the fluent chain.";

  if (/^typeof\s+/.test(t))
    return "Narrow the runtime type before using the value.";
  if (/^Number\./.test(t) || /^Number\(/.test(t))
    return "Coerce or check numeric finiteness.";
  if (/^new\s+Date\(/.test(t)) return "Parse into a Date for downstream use.";
  if (/^new\s+AppError\(/.test(t) || /^AppError\(/.test(t))
    return "Construct a typed HTTP/application error.";

  if (/^LocationKind\./.test(t))
    return "Specialize the board factory by location kind.";
  if (/^["'].*not found["'],?\s*$/i.test(t))
    return "Client-facing message when the entity is missing or out of scope.";
  if (/^["'].*["'],?\s*$/.test(t)) return "Pass string literal argument.";

  if (/^\}\)\./.test(t))
    return "Close the builder and continue the chain.";

  if (/^[A-Za-z_$][\w$.]*\s*,?\s*$/.test(t))
    return `Pass ${t.replace(/,$/, "")} through.`;

  if (t === "{" || t === "(" || t === "[") return null; // skip noise openers
  if (/^\?/.test(t) || /^:/.test(t))
    return "Continue the conditional expression.";
  if (/^&&/.test(t) || /^\|\|/.test(t))
    return "Continue the boolean expression.";

  if (ctx.isTest) return "Arrange or act for this test case.";
  return "Continue the controller logic.";
}

function precedingIsAdequateComment(lines, idx) {
  // Walk back over blank lines; if we hit a comment, treat as adequate.
  for (let i = idx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (isCommentLine(t)) return true;
    return false;
  }
  return false;
}

function processFile(filePath) {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  const original = fs.readFileSync(filePath, "utf8");
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  // split keeps a trailing empty element when file ends with newline
  const isTest = /\.test\.ts$/.test(filePath);
  const out = [];
  let commentsAdded = 0;
  let linesSkippedForSafety = 0;
  const skipReasons = [];
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Trailing empty from final newline — preserve by joining later
    if (i === lines.length - 1 && line === "" && original.match(/\r?\n$/)) {
      break;
    }
    const trimmed = line.trim();

    // Track multi-line import `{ ... } from`
    if (/^import\s+/.test(trimmed) && trimmed.includes("{") && !trimmed.includes("}")) {
      inImportBlock = true;
    } else if (inImportBlock && /^\} from\s+/.test(trimmed)) {
      inImportBlock = false;
    }

    // Always preserve the original line exactly; decide whether to insert ABOVE.
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (isCommentLine(trimmed)) {
      out.push(line);
      continue;
    }
    if (isPureClosing(trimmed)) {
      out.push(line);
      continue;
    }

    // Skip if adequate comment already above or meaningful inline comment present
    if (precedingIsAdequateComment(lines, i) || hasInlineComment(line)) {
      out.push(line);
      continue;
    }

    // Skip lone openers that add noise without explaining behavior
    if (trimmed === "{" || trimmed === "(" || trimmed === "[") {
      linesSkippedForSafety++;
      skipReasons.push({
        file: rel,
        lineHint: trimmed,
        reason: "pure opener bracket",
      });
      out.push(line);
      continue;
    }

    const text = commentFor(line, { isTest, inImportBlock });
    if (!text) {
      linesSkippedForSafety++;
      skipReasons.push({
        file: rel,
        lineHint: trimmed.slice(0, 80),
        reason: "no safe comment generated",
      });
      out.push(line);
      continue;
    }

    const ind = indentOf(line);
    out.push(`${ind}// ${text}`);
    commentsAdded++;
    out.push(line);
  }

  // Preserve trailing newline style and EOL
  let next = out.join(nl);
  if (original.match(/\r?\n$/)) {
    if (!next.endsWith("\n")) next += nl;
  } else if (next.endsWith("\r\n")) {
    next = next.slice(0, -2);
  } else if (next.endsWith("\n")) {
    next = next.slice(0, -1);
  }

  // Safety: every original line must appear in order as a subsequence
  const origLines = original.split(/\r?\n/);
  if (original.match(/\r?\n$/)) origLines.pop();
  let oi = 0;
  const nextLines = next.split(/\r?\n/);
  if (next.match(/\r?\n$/)) nextLines.pop();
  for (const l of nextLines) {
    if (oi < origLines.length && l === origLines[oi]) oi++;
  }
  if (oi !== origLines.length) {
    // Do not write corrupt file
    return {
      rel,
      modified: false,
      commentsAdded: 0,
      linesSkippedForSafety,
      skipReasons,
      error: `integrity check failed: matched ${oi}/${origLines.length} original lines`,
    };
  }

  if (commentsAdded > 0) {
    fs.writeFileSync(filePath, next, "utf8");
  }

  return {
    rel,
    modified: commentsAdded > 0,
    commentsAdded,
    linesSkippedForSafety,
    skipReasons,
    error: null,
  };
}

const files = walk(ROOT);
const results = files.map(processFile);

const report = {
  batch: "api-controllers",
  filesInspected: files.length,
  filesModified: results.filter((r) => r.modified).length,
  commentsAdded: results.reduce((a, r) => a + r.commentsAdded, 0),
  linesSkippedForSafety: results.reduce((a, r) => a + r.linesSkippedForSafety, 0),
  skipReasons: results.flatMap((r) => r.skipReasons).slice(0, 200),
  errors: results.filter((r) => r.error).map((r) => ({ file: r.rel, error: r.error })),
};

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
