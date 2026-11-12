/**
 * Insert English comment lines above uncommented source lines.
 * ONLY inserts new comment lines — never modifies existing lines.
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
    t === ");," ||
    t === ")," ||
    t === "),"
  )
    return true;
  if (/^[}\]\);,{]+$/.test(t)) return true;
  return false;
}

/** Rough string/template tracking across lines (best-effort safety). */
function createStringTracker() {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inBlockComment = false;
  let inLineComment = false;

  return {
    feed(line) {
      inLineComment = false;
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
        if (inLineComment) {
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
        if (inTemplate) {
          if (c === "\\") {
            i += 2;
            continue;
          }
          if (c === "`") inTemplate = false;
          i++;
          continue;
        }
        if (c === "/" && next === "/") {
          inLineComment = true;
          i += 2;
          continue;
        }
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
          i++;
          continue;
        }
        i++;
      }
    },
    insideString() {
      return inSingle || inDouble || inTemplate;
    },
    insideBlockComment() {
      return inBlockComment;
    },
  };
}

/** Detect JSX text-only lines (unsafe to comment as if code). */
function looksLikeJsxText(t) {
  // Pure text node content: letters/spaces/punct without JSX/TS syntax starters
  if (/^[{}<>/=]/.test(t)) return false;
  if (/^(import|export|const|let|var|function|class|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|typeof|await|async|type|interface|enum|extends|implements|from|default|void|null|true|false)\b/.test(t))
    return false;
  if (/^[A-Za-z_$][\w$]*\s*[=:(<\.]/.test(t)) return false;
  if (/^[A-Za-z_$][\w$]*\s*\{/.test(t)) return false;
  if (/^<\/?[A-Za-z]/.test(t)) return false;
  if (/[{};=<>]/.test(t) && /[=<>{]/.test(t)) {
    // has code-like tokens
    if (/=>/.test(t) || /[{}]/.test(t) || /=/.test(t) || /<\/?[A-Za-z]/.test(t))
      return false;
  }
  // Heuristic: mostly words, maybe punctuation, no code operators
  if (/^[A-Za-zА-Яа-я0-9][\w\s.,!?:;'\"%\-–—()/]+$/.test(t) && !/\(|\)|:|;|=/.test(t.replace(/:\s*$/, ""))) {
    // allow trailing colon for labels? still risky — treat as JSX text if no paren/brace
    if (!/[`()[\]{}=<>]/.test(t) && t.split(/\s+/).length >= 1 && /[A-Za-zА-Яа-я]/.test(t)) {
      // Could be a type union member like | "foo" — those start with |
      return true;
    }
  }
  return false;
}

function hasInlineComment(line, ext) {
  if (ext === ".css") return false;
  // crude: // outside strings at end
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
  if (/^[\.\#\[]?[a-zA-Z0-9_\-\[\]="'.,:\s>+~*]+\{?$/.test(t) || /^[.#:[*]/.test(t))
    return "Style rule selector.";
  if (/^--[\w-]+:/.test(t)) return "CSS custom property (design token).";
  if (/^(min-|max-)?(width|height|margin|padding|display|grid|flex|position|inset|top|left|right|bottom|color|background|border|font|line-|letter-|text-|align|justify|align|gap|overflow|opacity|z-index|box-|transform|transition|animation|cursor|pointer|white-space|object-|aspect-|place-|outline|box-shadow|filter|backdrop|clip|content|list-|table-|vertical-|visibility|user-select|touch|scroll|overscroll|isolation|mix-|will-|contain|appearance)/i.test(t))
    return "Declare layout/visual property for this rule.";
  if (t.includes(":")) return "CSS declaration for this rule.";
  return "Stylesheet contribution.";
}

function describeTs(t, ext) {
  const trimmed = t.trim();

  if (/^import\b/.test(trimmed)) return "Import dependency used by this module.";
  if (/^export\s+\{/.test(trimmed)) return "Re-export selected public symbols.";
  if (/^export\s+type\b/.test(trimmed)) return "Export type alias for consumers.";
  if (/^export\s+async\s+function\b/.test(trimmed))
    return "Exported async function entry point.";
  if (/^export\s+function\b/.test(trimmed)) return "Exported function entry point.";
  if (/^export\s+const\b/.test(trimmed)) return "Exported constant / binding.";
  if (/^export\s+class\b/.test(trimmed)) return "Exported class definition.";
  if (/^export\s+default\b/.test(trimmed)) return "Default export for this module.";
  if (/^export\s+\*/.test(trimmed)) return "Re-export module surface.";
  if (/^export\s+\{/.test(trimmed) || trimmed === "export {")
    return "Named re-export list.";

  if (/^type\s+\w+/.test(trimmed)) return "Local type alias shaping data.";
  if (/^interface\s+\w+/.test(trimmed)) return "Interface describing object shape.";
  if (/^enum\s+\w+/.test(trimmed)) return "Enum of related constants.";
  if (/^class\s+\w+/.test(trimmed)) return "Class definition.";
  if (/^async\s+function\b/.test(trimmed) || /^function\b/.test(trimmed))
    return "Function definition.";
  if (/^const\s+\w+\s*=\s*async\b/.test(trimmed)) return "Async const function binding.";
  if (/^const\s+\w+\s*=\s*\(/.test(trimmed) || /^const\s+\w+\s*=\s*async\s*\(/.test(trimmed))
    return "Const arrow/function binding.";
  if (/^const\s+\w+/.test(trimmed)) return "Local constant binding.";
  if (/^let\s+\w+/.test(trimmed)) return "Mutable local binding.";
  if (/^var\s+\w+/.test(trimmed)) return "Variable binding.";

  if (/^return\b/.test(trimmed)) return "Return computed result to caller.";
  if (/^throw\b/.test(trimmed)) return "Abort with an error for the caller.";
  if (/^await\b/.test(trimmed)) return "Await async work before continuing.";
  if (/^if\s*\(/.test(trimmed)) return "Conditional branch for this case.";
  if (/^else\s+if\s*\(/.test(trimmed)) return "Alternate conditional branch.";
  if (/^else\b/.test(trimmed)) return "Fallback branch when prior checks fail.";
  if (/^for\s*\(/.test(trimmed) || /^for\s+await/.test(trimmed))
    return "Iterate collection / range.";
  if (/^while\s*\(/.test(trimmed)) return "Loop while condition holds.";
  if (/^switch\s*\(/.test(trimmed)) return "Dispatch on discriminant value.";
  if (/^case\b/.test(trimmed)) return "Handle this switch case.";
  if (/^default\s*:/.test(trimmed)) return "Default switch arm.";
  if (/^break\b/.test(trimmed)) return "Exit switch/loop.";
  if (/^continue\b/.test(trimmed)) return "Continue with next iteration.";
  if (/^try\b/.test(trimmed)) return "Guard fallible work.";
  if (/^catch\b/.test(trimmed)) return "Handle failure from try block.";
  if (/^finally\b/.test(trimmed)) return "Always-run cleanup after try/catch.";
  if (/^describe\s*\(/.test(trimmed)) return "Group related unit tests.";
  if (/^it\s*\(/.test(trimmed) || /^test\s*\(/.test(trimmed))
    return "Unit test case.";
  if (/^beforeEach\s*\(/.test(trimmed) || /^afterEach\s*\(/.test(trimmed) || /^before\s*\(/.test(trimmed) || /^after\s*\(/.test(trimmed))
    return "Test lifecycle hook.";
  if (/^assert\./.test(trimmed)) return "Assert expected test outcome.";

  if (/^\/[A-Za-z]/.test(trimmed) || /^<\/[A-Za-z]/.test(trimmed))
    return "JSX element boundary.";
  if (/^<[A-Za-z]/.test(trimmed)) return "Render JSX element.";
  if (/^\{\/\*/.test(trimmed)) return "JSX block comment.";
  if (/^\{/.test(trimmed) && ext === ".tsx") return "JSX expression container.";

  if (/^\.\.\./.test(trimmed)) return "Spread remaining fields/props.";
  if (/^readonly\b/.test(trimmed)) return "Readonly field on this type/class.";
  if (/^public\b|^private\b|^protected\b|^static\b/.test(trimmed))
    return "Member declaration with access modifier.";
  if (/^constructor\s*\(/.test(trimmed)) return "Construct instance and assign fields.";
  if (/^super\s*\(/.test(trimmed)) return "Invoke parent constructor/method.";
  if (/^this\./.test(trimmed)) return "Update or read instance state.";
  if (/^new\s+/.test(trimmed)) return "Construct a new instance.";
  if (/^delete\s+/.test(trimmed)) return "Remove property/key.";
  if (/^void\s+/.test(trimmed)) return "Fire-and-forget async/side effect.";

  // Property / field lines in types
  if (/^[A-Za-z_$][\w$]*\??\s*:/.test(trimmed) && !trimmed.includes("=>") && !trimmed.startsWith("case "))
    return "Field/property in this shape.";
  if (/^\|\s*/.test(trimmed) || /^&\s*/.test(trimmed))
    return "Union/intersection type member.";
  if (/^[A-Za-z_$][\w$]*\s*,$/.test(trimmed) || /^type\s+\w+\s*,$/.test(trimmed))
    return "List item in import/export/params.";
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return "Identifier continuation in list.";

  // Method calls / assignments
  if (/=/.test(trimmed) && !/=>/.test(trimmed)) return "Assign value for subsequent use.";
  if (/=>/.test(trimmed)) return "Arrow function / callback body.";
  if (/\(/.test(trimmed) && /\)/.test(trimmed)) return "Invoke helper or pass arguments.";
  if (trimmed.endsWith(",")) return "Continue multi-line list/arguments.";
  if (trimmed.endsWith("(") || trimmed.endsWith("{") || trimmed.endsWith("["))
    return "Open multi-line construct.";
  if (trimmed.startsWith(")") || trimmed.startsWith("]") || trimmed.startsWith("}"))
    return "Close multi-line construct with trailing syntax.";

  return "Continue module logic.";
}

function makeComment(line, ext) {
  const ind = indentOf(line);
  const t = line.trim();
  if (ext === ".css") {
    return ind + "/* " + describeCss(t) + " */";
  }
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
  // Drop phantom empty last entry when file ends with newline
  const endsWithNl = /\r?\n$/.test(original);
  if (endsWithNl && lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const tracker = createStringTracker();
  const out = [];
  let commentsAdded = 0;
  let linesSkippedForSafety = 0;
  const skipReasons = [];

  // Pre-scan: mark lines that are inside multi-line strings at start
  const insideAt = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    insideAt[i] = tracker.insideString() || tracker.insideBlockComment();
    tracker.feed(lines[i]);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (!t) {
      out.push(line);
      continue;
    }
    if (isComment(t, ext)) {
      out.push(line);
      continue;
    }
    if (isPureClosing(t)) {
      out.push(line);
      continue;
    }
    if (hasCommentAbove(out, out.length, ext) || hasInlineComment(line, ext)) {
      out.push(line);
      continue;
    }

    // Safety: inside string/template continuation
    if (insideAt[i]) {
      linesSkippedForSafety++;
      skipReasons.push({
        file: filePath,
        lineHint: t.slice(0, 60),
        reason: "inside string/template/block-comment continuation",
      });
      out.push(line);
      continue;
    }

    // Safety: JSX text nodes — never insert comments into element text
    if (ext === ".tsx" && looksLikeJsxText(t)) {
      if (
        !/[`()[\]{};=<>]/.test(t) &&
        !/^(true|false|null|undefined)\b/.test(t) &&
        !/^\d/.test(t) &&
        !/^[A-Z_][A-Z0-9_]+$/.test(t) &&
        !/^(import|export|const|let|var|type|function|return|if|for|while|switch|class|interface|enum|describe|it|assert|await|throw|try|catch|new|void|delete|yield|debugger)\b/.test(
          t,
        )
      ) {
        linesSkippedForSafety++;
        skipReasons.push({
          file: filePath,
          lineHint: t.slice(0, 60),
          reason: "possible JSX text node",
        });
        out.push(line);
        continue;
      }
    }

    // Insert comment above (same indentation as the source line)
    out.push(makeComment(line, ext));
    commentsAdded++;
    out.push(line);
  }

  let finalText = out.join(nl);
  if (endsWithNl) finalText += nl;
  if (finalText !== original) {
    fs.writeFileSync(filePath, finalText, "utf8");
  }
  return {
    commentsAdded,
    linesSkippedForSafety,
    skipReasons,
    modified: finalText !== original,
  };
}

const report = {
  batch: "web-core",
  filesInspected: 0,
  filesModified: 0,
  commentsAdded: 0,
  linesSkippedForSafety: 0,
  skipReasons: [],
  errors: [],
};

for (const f of files) {
  report.filesInspected++;
  try {
    const r = processFile(f);
    if (r.modified) report.filesModified++;
    report.commentsAdded += r.commentsAdded;
    report.linesSkippedForSafety += r.linesSkippedForSafety;
    // Cap skip reasons to keep report readable
    for (const s of r.skipReasons) {
      if (report.skipReasons.length < 200) report.skipReasons.push(s);
    }
  } catch (err) {
    report.errors.push({ file: f, message: String(err && err.message ? err.message : err) });
  }
}

const outDir = ".comment-batches/reports";
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "web-core.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
console.log("Wrote", outPath);
