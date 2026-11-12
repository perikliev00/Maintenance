/**
 * Second pass: comment lines still missing comments, with better
 * template-${} and JSX-text heuristics. Comment lines only.
 */
const fs = require("fs");
const path = require("path");

const roots = [
  "web/src/api",
  "web/src/lib",
  "web/src/offline",
  "web/src/components",
  "web/src/hooks",
  "web/src/styles",
];
const extras = ["web/src/App.tsx", "web/src/App.css", "web/src/main.tsx"];

function walk(d, acc = []) {
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|css)$/.test(e.name)) acc.push(p.replace(/\\/g, "/"));
  }
  return acc;
}

let files = [];
for (const r of roots) walk(r, files);
for (const e of extras) if (fs.existsSync(e)) files.push(e);
files = [...new Set(files)].sort();

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

function isComment(t, ext) {
  if (!t) return false;
  if (ext === ".css") {
    return (
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.endsWith("*/") ||
      t.startsWith("//")
    );
  }
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.endsWith("*/")
  );
}

function isPureClosing(t) {
  if (!t) return true;
  if (
    t === "{" ||
    t === "}" ||
    t === "};" ||
    t === "}," ||
    t === ");" ||
    t === "]" ||
    t === "]," ||
    t === "/>" ||
    t === ">" ||
    t === "})" ||
    t === "});" ||
    t === ">;" ||
    t === "),"
  )
    return true;
  if (/^[}\]\);,{]+$/.test(t)) return true;
  return false;
}

/** Track strings; expose whether we are in raw template text (unsafe) vs ${} code (safe). */
function createTracker() {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let templateExprDepth = 0; // >0 means inside ${ ... }
  let inBlockComment = false;
  let braceDepthInExpr = 0;

  function feed(line) {
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const next = line[i + 1];

      if (inBlockComment) {
        if (c === "*" && next === "/") {
          inBlockComment = false;
          i += 2;
          continue;
        }
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
      if (inDouble) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') inDouble = false;
        i++;
        continue;
      }

      if (inTemplate && templateExprDepth > 0) {
        // Inside ${} — treat as code, track braces and nested strings lightly
        if (c === "/" && next === "/") break; // rest of line comment in expr
        if (c === "/" && next === "*") {
          inBlockComment = true;
          i += 2;
          continue;
        }
        if (c === "'" && braceDepthInExpr >= 0) {
          inSingle = true;
          i++;
          continue;
        }
        if (c === '"') {
          inDouble = true;
          i++;
          continue;
        }
        if (c === "`") {
          // nested template — approximate as double-ish by toggling nested
          // For safety, enter nested template without expr
          inTemplate = true;
          // keep expr depth; nested template text is unsafe until its own ${}
          i++;
          continue;
        }
        if (c === "{") braceDepthInExpr++;
        if (c === "}") {
          if (braceDepthInExpr === 0) {
            templateExprDepth--;
            i++;
            continue;
          }
          braceDepthInExpr--;
        }
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
          templateExprDepth++;
          braceDepthInExpr = 0;
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      if (c === "/" && next === "/") break;
      if (c === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        i++;
        continue;
      }
      if (c === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (c === "`") {
        inTemplate = true;
        templateExprDepth = 0;
        i++;
        continue;
      }
      i++;
    }
  }

  return {
    feed,
    /** True when a newline would land inside string/template TEXT (not ${}). */
    unsafeForComment() {
      if (inBlockComment) return true;
      if (inSingle || inDouble) return true;
      if (inTemplate && templateExprDepth === 0) return true;
      return false;
    },
  };
}

/** Only multi-word prose without code tokens — likely JSX text. */
function isJsxTextProse(t) {
  if (/[`${}[\]<=>;]|=>/.test(t)) return false;
  if (/[,:)(.]/.test(t)) return false; // code punctuation
  if (!/[A-Za-zА-Яа-я]/.test(t)) return false;
  // require at least two words to treat as prose text node
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/^(import|export|const|let|var|function|class|return|type|interface)\b/.test(t))
    return false;
  return true;
}

function hasInlineComment(line, ext) {
  if (ext === ".css") return false;
  const idx = line.indexOf("//");
  if (idx === -1) return false;
  const before = line.slice(0, idx);
  const singles = (before.match(/'/g) || []).length;
  const doubles = (before.match(/"/g) || []).length;
  const ticks = (before.match(/`/g) || []).length;
  if (singles % 2 || doubles % 2 || ticks % 2) return false;
  return true;
}

function describeCss(t) {
  if (t.startsWith(":root") || t.startsWith("[data-theme"))
    return "Theme tokens / root selector scope.";
  if (t.startsWith("@media")) return "Responsive breakpoint overrides.";
  if (t.startsWith("@keyframes")) return "Animation keyframe definition.";
  if (/^--[\w-]+:/.test(t)) return "CSS custom property (design token).";
  if (/^[.#:[*]/.test(t) || /\{$/.test(t)) return "Style rule selector.";
  if (t.includes(":")) return "CSS declaration for this rule.";
  return "Stylesheet contribution.";
}

function describeTs(t, ext) {
  const trimmed = t.trim();
  if (/^import\b/.test(trimmed)) return "Import dependency used by this module.";
  if (/^export\s+type\b/.test(trimmed)) return "Export type alias for consumers.";
  if (/^export\s+async\s+function\b/.test(trimmed))
    return "Exported async function entry point.";
  if (/^export\s+function\b/.test(trimmed)) return "Exported function entry point.";
  if (/^export\s+const\b/.test(trimmed)) return "Exported constant / binding.";
  if (/^export\s+class\b/.test(trimmed)) return "Exported class definition.";
  if (/^export\s+default\b/.test(trimmed)) return "Default export for this module.";
  if (/^export\s+\*/.test(trimmed) || /^export\s+\{/.test(trimmed))
    return "Re-export selected public symbols.";
  if (/^type\s+\w+/.test(trimmed)) return "Local type alias shaping data.";
  if (/^interface\s+\w+/.test(trimmed)) return "Interface describing object shape.";
  if (/^async\s+function\b/.test(trimmed) || /^function\b/.test(trimmed))
    return "Function definition.";
  if (/^const\s+\w+/.test(trimmed)) return "Local constant binding.";
  if (/^let\s+\w+/.test(trimmed)) return "Mutable local binding.";
  if (/^return\b/.test(trimmed)) return "Return computed result to caller.";
  if (/^throw\b/.test(trimmed)) return "Abort with an error for the caller.";
  if (/^await\b/.test(trimmed)) return "Await async work before continuing.";
  if (/^if\s*\(/.test(trimmed)) return "Conditional branch for this case.";
  if (/^else\s+if\s*\(/.test(trimmed)) return "Alternate conditional branch.";
  if (/^else\b/.test(trimmed)) return "Fallback branch when prior checks fail.";
  if (/^for\s*\(/.test(trimmed)) return "Iterate collection / range.";
  if (/^while\s*\(/.test(trimmed)) return "Loop while condition holds.";
  if (/^switch\s*\(/.test(trimmed)) return "Dispatch on discriminant value.";
  if (/^case\b/.test(trimmed)) return "Handle this switch case.";
  if (/^try\b/.test(trimmed)) return "Guard fallible work.";
  if (/^catch\b/.test(trimmed)) return "Handle failure from try block.";
  if (/^finally\b/.test(trimmed)) return "Always-run cleanup after try/catch.";
  if (/^describe\s*\(/.test(trimmed)) return "Group related unit tests.";
  if (/^it\s*\(/.test(trimmed) || /^test\s*\(/.test(trimmed)) return "Unit test case.";
  if (/^assert\./.test(trimmed)) return "Assert expected test outcome.";
  if (/^<[A-Za-z\/]/.test(trimmed)) return "Render JSX element.";
  if (/^\|\s*/.test(trimmed) || /^&\s*/.test(trimmed))
    return "Union/intersection type member.";
  if (/^[A-Za-z_$][\w$]*\??\s*:/.test(trimmed)) return "Field/property in this shape.";
  if (/^[A-Za-z_$][\w$]*\s*,$/.test(trimmed)) return "List item in import/export/params.";
  if (/=/.test(trimmed) && !/=>/.test(trimmed)) return "Assign value for subsequent use.";
  if (/=>/.test(trimmed)) return "Arrow function / callback body.";
  if (/\(/.test(trimmed)) return "Invoke helper or pass arguments.";
  if (trimmed.endsWith(",")) return "Continue multi-line list/arguments.";
  if (ext === ".tsx" && /^[A-Za-z_$][\w$]*$/.test(trimmed))
    return "JSX boolean prop or identifier.";
  return "Continue module logic.";
}

function makeComment(line, ext) {
  const ind = indentOf(line);
  const t = line.trim();
  if (ext === ".css") return ind + "/* " + describeCss(t) + " */";
  return ind + "// " + describeTs(t, ext);
}

function hasCommentAbove(lines, index, ext) {
  for (let j = index - 1; j >= 0; j--) {
    const prev = lines[j].trim();
    if (!prev) continue;
    return isComment(prev, ext);
  }
  return false;
}

function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const original = fs.readFileSync(filePath, "utf8");
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const endsWithNl = /\r?\n$/.test(original);
  if (endsWithNl && lines.length && lines[lines.length - 1] === "") lines.pop();

  const tracker = createTracker();
  const unsafeAt = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    unsafeAt[i] = tracker.unsafeForComment();
    tracker.feed(lines[i]);
  }

  const out = [];
  let commentsAdded = 0;
  let linesSkippedForSafety = 0;
  const skipReasons = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (!t || isComment(t, ext) || isPureClosing(t)) {
      out.push(line);
      continue;
    }
    if (hasCommentAbove(out, out.length, ext) || hasInlineComment(line, ext)) {
      out.push(line);
      continue;
    }

    if (unsafeAt[i]) {
      linesSkippedForSafety++;
      if (skipReasons.length < 100) {
        skipReasons.push({
          file: filePath,
          lineHint: t.slice(0, 60),
          reason: "inside string/template text (unsafe)",
        });
      }
      out.push(line);
      continue;
    }

    if (ext === ".tsx" && isJsxTextProse(t)) {
      linesSkippedForSafety++;
      if (skipReasons.length < 100) {
        skipReasons.push({
          file: filePath,
          lineHint: t.slice(0, 60),
          reason: "possible JSX text node",
        });
      }
      out.push(line);
      continue;
    }

    out.push(makeComment(line, ext));
    commentsAdded++;
    out.push(line);
  }

  let finalText = out.join(nl);
  if (endsWithNl) finalText += nl;
  if (finalText !== original) fs.writeFileSync(filePath, finalText, "utf8");
  return {
    commentsAdded,
    linesSkippedForSafety,
    skipReasons,
    modified: finalText !== original,
  };
}

// Load pass1 report to accumulate totals
const reportPath = ".comment-batches/reports/web-core.json";
const prev = JSON.parse(fs.readFileSync(reportPath, "utf8"));

const pass = {
  filesInspected: 0,
  filesModified: 0,
  commentsAdded: 0,
  linesSkippedForSafety: 0,
  skipReasons: [],
  errors: [],
};

for (const f of files) {
  pass.filesInspected++;
  try {
    const r = processFile(f);
    if (r.modified) pass.filesModified++;
    pass.commentsAdded += r.commentsAdded;
    pass.linesSkippedForSafety += r.linesSkippedForSafety;
    for (const s of r.skipReasons) {
      if (pass.skipReasons.length < 200) pass.skipReasons.push(s);
    }
  } catch (err) {
    pass.errors.push({
      file: f,
      message: String(err && err.message ? err.message : err),
    });
  }
}

const report = {
  batch: "web-core",
  filesInspected: pass.filesInspected,
  filesModified: prev.filesModified, // all already touched in pass1
  commentsAdded: prev.commentsAdded + pass.commentsAdded,
  linesSkippedForSafety: pass.linesSkippedForSafety,
  skipReasons: pass.skipReasons,
  errors: [...prev.errors, ...pass.errors],
  pass2: {
    commentsAdded: pass.commentsAdded,
    filesModified: pass.filesModified,
  },
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(
  JSON.stringify(
    {
      pass2Comments: pass.commentsAdded,
      pass2FilesModified: pass.filesModified,
      totalComments: report.commentsAdded,
      stillSkipped: report.linesSkippedForSafety,
      errors: report.errors,
    },
    null,
    2,
  ),
);
