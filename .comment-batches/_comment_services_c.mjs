#!/usr/bin/env node
/**
 * Comment-only inserter for api/src/services batch C.
 * ONLY inserts new // comment lines; never modifies existing lines.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "c:\\Users\\Admin\\Desktop\\maintenance";
const SERVICES = path.join(ROOT, "api", "src", "services");
const EXCLUDED_TOP = new Set([
  "analytics",
  "attendance",
  "cleaning",
  "cleaningResults",
  "dailyPlan",
  "dailyPlanEffects",
  "cards",
  "authorization",
]);

const report = {
  batch: "api-services-c",
  filesInspected: 0,
  filesModified: 0,
  commentsAdded: 0,
  linesSkippedForSafety: 0,
  skipReasons: [],
  errors: [],
};

function listTsFiles(dir, topRel = "") {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = topRel ? `${topRel}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const top = rel.split(/[\\/]/)[0];
      if (!topRel && EXCLUDED_TOP.has(ent.name)) continue;
      out.push(...listTsFiles(full, rel));
    } else if (ent.isFile() && ent.name.endsWith(".ts")) {
      out.push({ full, rel: rel.replace(/\\/g, "/") });
    }
  }
  return out;
}

function isClosingOnly(trimmed) {
  return /^[}\]\);,]+$/.test(trimmed);
}

function isCommentLine(trimmed) {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.endsWith("*/")
  );
}

/** Track whether a line continues an open string/template/regex from prior state. */
function scanLineState(line, state) {
  // state: { inTemplate, inDouble, inSingle, inBlockComment, inRegex }
  let i = 0;
  const chars = line;
  let { inTemplate, inDouble, inSingle, inBlockComment } = state;

  if (inBlockComment) {
    const end = chars.indexOf("*/");
    if (end === -1) return { ...state, fullyInsideLiteral: true };
    inBlockComment = false;
    i = end + 2;
  }

  // If already inside a string from previous line, consume until close (with escapes / ${})
  const startInside = inTemplate || inDouble || inSingle;
  let fullyInsideLiteral = startInside;

  while (i < chars.length) {
    const c = chars[i];
    const next = chars[i + 1];

    if (inDouble) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') inDouble = false;
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (inTemplate) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        inTemplate = false;
        i++;
        continue;
      }
      if (c === "$" && next === "{") {
        // Enter expression; for simplicity treat rest of ${...} nesting lightly
        i += 2;
        let depth = 1;
        while (i < chars.length && depth > 0) {
          const ch = chars[i];
          if (ch === "`") {
            // nested template — recurse roughly
            i++;
            while (i < chars.length && chars[i] !== "`") {
              if (chars[i] === "\\") i += 2;
              else i++;
            }
            i++;
            continue;
          }
          if (ch === "'" || ch === '"') {
            const q = ch;
            i++;
            while (i < chars.length && chars[i] !== q) {
              if (chars[i] === "\\") i += 2;
              else i++;
            }
            i++;
            continue;
          }
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          i++;
        }
        continue;
      }
      i++;
      continue;
    }

    // code context
    fullyInsideLiteral = false;
    if (c === "/" && next === "/") break; // line comment
    if (c === "/" && next === "*") {
      const end = chars.indexOf("*/", i + 2);
      if (end === -1) {
        inBlockComment = true;
        break;
      }
      i = end + 2;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      i++;
      continue;
    }
    i++;
  }

  return {
    inTemplate,
    inDouble,
    inSingle,
    inBlockComment,
    fullyInsideLiteral: startInside && (inTemplate || inDouble || inSingle || fullyInsideLiteral),
    startedInside: startInside,
  };
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

function summarizeIdent(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function commentForLine(line, trimmed, ctx) {
  // Imports
  if (/^import\s+type\s+/.test(trimmed)) {
    const m = trimmed.match(/import\s+type\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))/);
    const names = (m?.[1] || m?.[2] || m?.[3] || "types").replace(/\s+/g, " ").trim();
    return `Import type(s) ${names} for typing without runtime cost.`;
  }
  if (/^import\s+/.test(trimmed)) {
    const m = trimmed.match(/from\s+["']([^"']+)["']/);
    const mod = m?.[1] ?? "dependency";
    return `Import module ${mod} for this service.`;
  }
  if (/^export\s+\*\s+from\s+/.test(trimmed)) {
    const m = trimmed.match(/from\s+["']([^"']+)["']/);
    return `Re-export public API from ${m?.[1] ?? "module"}.`;
  }
  if (/^export\s+\{/.test(trimmed) || /^export\s+type\s+\{/.test(trimmed)) {
    return `Re-export selected symbols for barrel consumers.`;
  }
  if (/^export\s+type\s+/.test(trimmed) || /^type\s+\w+/.test(trimmed)) {
    const m = trimmed.match(/(?:export\s+)?type\s+(\w+)/);
    return `Declare type ${m?.[1] ?? "alias"} for callers and internals.`;
  }
  if (/^export\s+interface\s+/.test(trimmed) || /^interface\s+/.test(trimmed)) {
    const m = trimmed.match(/interface\s+(\w+)/);
    return `Define interface ${m?.[1] ?? ""} shaping this domain object.`;
  }
  if (/^export\s+enum\s+/.test(trimmed) || /^enum\s+/.test(trimmed)) {
    const m = trimmed.match(/enum\s+(\w+)/);
    return `Enumerate ${m?.[1] ?? "values"} used by this service.`;
  }
  if (/^export\s+(async\s+)?function\s+/.test(trimmed) || /^(async\s+)?function\s+/.test(trimmed)) {
    const m = trimmed.match(/function\s+(\w+)/);
    return `Define ${m?.[1] ?? "function"} — core behavior for this module.`;
  }
  if (/^export\s+const\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed) || /^const\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed)) {
    const m = trimmed.match(/const\s+(\w+)/);
    return `Define ${m?.[1] ?? "handler"} as a callable used by this flow.`;
  }
  if (/^export\s+class\s+/.test(trimmed) || /^class\s+/.test(trimmed)) {
    const m = trimmed.match(/class\s+(\w+)/);
    return `Define class ${m?.[1] ?? ""} encapsulating related behavior.`;
  }
  if (/^export\s+default\s+/.test(trimmed)) {
    return `Provide the default export for this module.`;
  }
  if (/^export\s+const\s+/.test(trimmed) || /^export\s+let\s+/.test(trimmed)) {
    const m = trimmed.match(/export\s+(?:const|let)\s+(\w+)/);
    return `Export ${m?.[1] ?? "value"} for reuse by other modules.`;
  }

  // Control flow
  if (/^if\s*\(/.test(trimmed)) {
    return `Branch when this condition holds so the right path runs.`;
  }
  if (/^else\s+if\s*\(/.test(trimmed)) {
    return `Handle the alternate condition when prior branches did not match.`;
  }
  if (/^else\s*\{?\s*$/.test(trimmed) || /^else\s+\{/.test(trimmed)) {
    return `Fall through when no earlier condition matched.`;
  }
  if (/^for\s*\(/.test(trimmed) || /^for\s+await\s*\(/.test(trimmed)) {
    return `Iterate items to apply the same logic to each entry.`;
  }
  if (/^while\s*\(/.test(trimmed)) {
    return `Loop while the condition remains true.`;
  }
  if (/^switch\s*\(/.test(trimmed)) {
    return `Dispatch on the discriminant to pick the matching case.`;
  }
  if (/^case\s+/.test(trimmed)) {
    return `Handle this specific case value.`;
  }
  if (/^default\s*:/.test(trimmed)) {
    return `Cover any unmatched case.`;
  }
  if (/^try\s*\{/.test(trimmed)) {
    return `Attempt the fallible work so errors can be handled below.`;
  }
  if (/^catch\s*\(/.test(trimmed) || /^catch\s*\{/.test(trimmed)) {
    return `Handle failure without letting it escape unchecked.`;
  }
  if (/^finally\s*\{/.test(trimmed)) {
    return `Always run cleanup whether the try succeeded or failed.`;
  }
  if (/^throw\s+/.test(trimmed)) {
    return `Abort with an error so callers can react.`;
  }
  if (/^return\s*;?\s*$/.test(trimmed)) {
    return `Exit early; nothing more to do on this path.`;
  }
  if (/^return\s+/.test(trimmed)) {
    return `Return the computed result to the caller.`;
  }
  if (/^await\s+/.test(trimmed)) {
    return `Wait for the async step before continuing.`;
  }
  if (/^continue\s*;?\s*$/.test(trimmed)) {
    return `Skip to the next loop iteration.`;
  }
  if (/^break\s*;?\s*$/.test(trimmed)) {
    return `Leave the current loop or switch.`;
  }

  // Declarations
  if (/^(const|let|var)\s+/.test(trimmed)) {
    const m = trimmed.match(/^(?:const|let|var)\s+(\w+)/);
    const name = m?.[1] ?? "value";
    if (/await\s+/.test(trimmed)) {
      return `Load ${summarizeIdent(name)} asynchronously for the next steps.`;
    }
    if (/^const\s+\w+\s*=\s*\{/.test(trimmed)) {
      return `Build ${summarizeIdent(name)} object holding related fields.`;
    }
    if (/^const\s+\w+\s*=\s*\[/.test(trimmed)) {
      return `Collect ${summarizeIdent(name)} list for later processing.`;
    }
    if (/^const\s+\{\s*/.test(trimmed) || /^const\s+\[/.test(trimmed)) {
      return `Destructure ${summarizeIdent(name)} fields needed locally.`;
    }
    return `Capture ${summarizeIdent(name)} for use in this scope.`;
  }

  // Method / property style
  if (/^(public|private|protected|readonly|static)\s+/.test(trimmed)) {
    return `Declare this member as part of the class contract.`;
  }
  if (/^constructor\s*\(/.test(trimmed)) {
    return `Initialize instance state when constructed.`;
  }
  if (/^get\s+\w+\s*\(/.test(trimmed)) {
    return `Expose a derived getter without storing duplicate state.`;
  }
  if (/^set\s+\w+\s*\(/.test(trimmed)) {
    return `Accept updates through a controlled setter.`;
  }
  if (/^async\s+\w+\s*\(/.test(trimmed) || /^\w+\s*\([^)]*\)\s*:\s*/.test(trimmed) || /^\w+\s*\([^)]*\)\s*\{/.test(trimmed)) {
    if (!trimmed.includes("=") && !trimmed.startsWith("if") && !trimmed.startsWith("for")) {
      const m = trimmed.match(/^(?:async\s+)?(\w+)\s*\(/);
      if (m && !["if", "for", "while", "switch", "catch", "function"].includes(m[1])) {
        return `Implement ${m[1]} behavior for this type.`;
      }
    }
  }

  // Object / array property lines
  if (/^[\w"']+\s*:/.test(trimmed) && !trimmed.startsWith("case")) {
    const m = trimmed.match(/^["']?([\w]+)["']?\s*:/);
    return `Set ${m?.[1] ?? "field"} on the structure being built.`;
  }

  // Calls / assignments
  if (/^\w+\.\w+/.test(trimmed) || /^await\s+\w+/.test(trimmed)) {
    if (/\.push\(/.test(trimmed)) return `Append an entry to the accumulating collection.`;
    if (/\.set\(/.test(trimmed)) return `Store a keyed value for later lookup.`;
    if (/\.delete\(/.test(trimmed)) return `Remove the keyed entry that no longer applies.`;
    if (/\.emit\(/.test(trimmed) || /\.publish\(/.test(trimmed)) return `Notify listeners about this domain event.`;
    if (/\.log\.|log\.(info|warn|error|debug)/.test(trimmed)) return `Record observability detail for operators.`;
    if (/prisma\./i.test(trimmed) || /\.(findMany|findFirst|findUnique|create|update|delete|upsert|transaction)\(/.test(trimmed)) {
      return `Persist or query via Prisma for durable state.`;
    }
  }

  if (/^\w+\s*=/.test(trimmed)) {
    const m = trimmed.match(/^(\w+)\s*=/);
    return `Update ${summarizeIdent(m?.[1] ?? "value")} as control flow progresses.`;
  }

  if (/^\.\w+/.test(trimmed)) {
    return `Continue the chained call from the previous expression.`;
  }

  if (/^\?\./.test(trimmed) || /^\?/.test(trimmed) || /^:/.test(trimmed)) {
    return `Complete the ternary or optional chain started above.`;
  }

  if (/^&&/.test(trimmed) || /^\|\|/.test(trimmed)) {
    return `Extend the boolean expression with another clause.`;
  }

  if (/^</.test(trimmed) && ctx.isTsx) {
    report.linesSkippedForSafety++;
    report.skipReasons.push({
      file: ctx.file,
      lineHint: trimmed.slice(0, 80),
      reason: "Possible JSX; skipped for safety",
    });
    return null;
  }

  // Generic fallback grounded in truncated source
  const hint = trimmed.replace(/\s+/g, " ").slice(0, 60);
  return `Run next step: ${hint}${trimmed.length > 60 ? "…" : ""}`;
}

function processFile(full, rel) {
  report.filesInspected++;
  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch (e) {
    report.errors.push({ file: rel, error: String(e) });
    return;
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const isTsx = full.endsWith(".tsx");
  const out = [];
  let added = 0;

  let state = {
    inTemplate: false,
    inDouble: false,
    inSingle: false,
    inBlockComment: false,
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    const scanned = scanLineState(line, state);
    const startedInside =
      state.inTemplate || state.inDouble || state.inSingle || state.inBlockComment;

    // Decide whether to comment BEFORE updating output
    let shouldComment = true;
    if (!trimmed) shouldComment = false;
    else if (isClosingOnly(trimmed)) shouldComment = false;
    else if (isCommentLine(trimmed)) shouldComment = false;
    else if (startedInside) {
      shouldComment = false;
      report.linesSkippedForSafety++;
      report.skipReasons.push({
        file: rel,
        lineHint: trimmed.slice(0, 80),
        reason: "Inside string/template/block-comment; skipped for safety",
      });
    } else {
      // Adequate comment already immediately above (in output, last non-empty)?
      let j = out.length - 1;
      while (j >= 0 && out[j].trim() === "") j--;
      if (j >= 0 && isCommentLine(out[j].trim())) {
        shouldComment = false;
      }
      // Also: if previous original line was a block comment closer covering this
    }

    if (shouldComment) {
      const body = commentForLine(line, trimmed, { file: rel, isTsx });
      if (body) {
        const ind = indentOf(line);
        out.push(`${ind}// ${body}`);
        added++;
      }
    }

    out.push(line);

    state = {
      inTemplate: scanned.inTemplate,
      inDouble: scanned.inDouble,
      inSingle: scanned.inSingle,
      inBlockComment: scanned.inBlockComment,
    };
  }

  if (added > 0) {
    // Preserve trailing newline style
    const endsWithNl = text.endsWith("\n");
    let next = out.join(newline);
    if (endsWithNl && !next.endsWith(newline)) next += newline;
    if (!endsWithNl && next.endsWith(newline)) next = next.slice(0, -newline.length);
    fs.writeFileSync(full, next, "utf8");
    report.filesModified++;
    report.commentsAdded += added;
  }
}

const files = listTsFiles(SERVICES).sort((a, b) => a.rel.localeCompare(b.rel));
console.error(`Processing ${files.length} files...`);
for (const f of files) {
  try {
    processFile(f.full, `api/src/services/${f.rel}`);
  } catch (e) {
    report.errors.push({ file: f.rel, error: String(e) });
  }
}

// Cap skipReasons size for readability
if (report.skipReasons.length > 50) {
  report.skipReasons = report.skipReasons.slice(0, 50);
}

const outPath = path.join(ROOT, ".comment-batches", "reports", "api-services-c.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
