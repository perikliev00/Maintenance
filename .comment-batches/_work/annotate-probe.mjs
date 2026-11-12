#!/usr/bin/env node
/**
 * Comment-only annotator for remaining-b batch files.
 * Inserts English // / # / CSS comments above uncommented source lines.
 * Never modifies existing lines — only inserts new comment lines.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPORT = path.resolve(".comment-batches/reports/remaining-b-probe.json");

const FILES = [
  "web/src/app/App.tsx",
  "web/src/app/NavIcon.tsx",
  "scripts/verify-containers.mjs",
  "web/src/app/routing.tsx",
  "web/src/app/useAuthBootstrap.ts",
];

function isBlank(line) {
  return line.trim() === "";
}

function isShellExt(ext) {
  return ext === ".sh" || ext === ".ps1" || ext === ".bash";
}

function isCommentLine(line, ext) {
  const t = line.trim();
  if (!t) return false;
  if (ext === ".css") {
    return (
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.startsWith("//") ||
      t.endsWith("*/")
    );
  }
  if (isShellExt(ext)) {
    return t.startsWith("#");
  }
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.endsWith("*/") ||
    t.startsWith("{/*") ||
    t.startsWith("#")
  );
}

function isPureClosing(line) {
  const t = line.trim();
  return (
    t === "{" ||
    t === "}" ||
    t === "};" ||
    t === ")" ||
    t === ");" ||
    t === "]," ||
    t === "]" ||
    t === "}," ||
    t === ")}" ||
    t === "})}" ||
    t === "/>" ||
    t === ">" ||
    /^<\/[A-Za-z][^>]*>,?$/.test(t) ||
    t === "</>" ||
    /^\}\)[,;]?$/.test(t) ||
    /^\}\),?$/.test(t) ||
    /^\],?$/.test(t) ||
    /^\},?$/.test(t) ||
    /^\)[,;]?$/.test(t) ||
    /^[}\]\);,{]+$/.test(t)
  );
}

function isJsxClosingTag(line) {
  const t = line.trim();
  return /^<\//.test(t) || t === "/>" || t === "</>";
}

function indentOf(line) {
  const m = line.match(/^[ \t]*/);
  return m ? m[0] : "";
}

function describe(line, ext) {
  const t = line.trim();
  if (!t) return null;

  if (isShellExt(ext)) {
    if (/^#!/.test(t)) return "Declare the interpreter for this script.";
    if (/^set\s+-euo\s+pipefail/.test(t))
      return "Fail fast on errors, unset vars, and pipe failures.";
    if (/^set\s+-\w/.test(t))
      return "Configure shell option flags for safer execution.";
    if (/^usage\s*\(\)/.test(t) || /^\w+\s*\(\)\s*\{/.test(t)) {
      const n = t.match(/^([A-Za-z0-9_]+)\s*\(/);
      return n
        ? `Define shell function ${n[1]} used by this script.`
        : "Define a shell function used by this script.";
    }
    if (/^for\s+/.test(t)) return "Iterate over arguments or items.";
    if (/^while\s+/.test(t)) return "Loop while the condition remains true.";
    if (/^case\s+/.test(t)) return "Dispatch on a discrete argument value.";
    if (/^esac\b/.test(t)) return "End the case dispatch block.";
    if (/^if\s+/.test(t)) return "Conditional branch for this guard.";
    if (/^elif\s+/.test(t)) return "Alternate branch when prior guards failed.";
    if (/^else\b/.test(t)) return "Fallback branch when earlier conditions were false.";
    if (/^fi\b/.test(t)) return "Close the if/elif/else conditional.";
    if (/^then\b/.test(t)) return "Begin the true-branch body.";
    if (/^do\b/.test(t)) return "Begin the loop body.";
    if (/^done\b/.test(t)) return "Close the loop body.";
    if (/^return\b/.test(t)) return "Return from this shell function.";
    if (/^exit\b/.test(t)) return "Exit the script with the given status.";
    if (/^echo\b/.test(t)) return "Print status or usage information.";
    if (/^printf\b/.test(t)) return "Format and print output for the operator.";
    if (/^local\s+/.test(t) || /^readonly\s+/.test(t))
      return "Bind a local/readonly variable for this scope.";
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t))
      return "Assign a configuration or runtime variable.";
    if (/^\[\[/.test(t) || /^\[ /.test(t) || /^test\s+/.test(t))
      return "Evaluate a shell test condition.";
    if (/^cd\b/.test(t)) return "Change working directory for subsequent commands.";
    if (/^export\b/.test(t)) return "Export an environment variable for child processes.";
    if (/^source\b|^\.\s+/.test(t)) return "Source another script into this shell.";
    if (/^command\b|^npm\b|^npx\b|^node\b|^psql\b|^docker\b|^curl\b|^mkdir\b|^rm\b|^cp\b|^mv\b|^cat\b|^sed\b|^awk\b|^grep\b|^chmod\b|^chown\b|^tee\b|^trap\b|^wait\b|^kill\b|^python\b|^pip\b|^git\b/.test(t))
      return "Run an external command needed by this step.";
    if (/^Write-|^Get-|^Set-|^New-|^Remove-|^Test-|^Select-|^Where-|^ForEach-|^Invoke-|^Start-|^Stop-|^Out-|^Join-|^Split-|^Push-|^Pop-|^Import-|^Export-|^ConvertTo-|^ConvertFrom-/.test(t))
      return "Invoke a PowerShell cmdlet for this step.";
    if (/^param\s*\(/.test(t)) return "Declare script parameters accepted by PowerShell.";
    if (/^\$[A-Za-z_]/.test(t) && /=/.test(t))
      return "Assign a PowerShell variable used below.";
    if (/^function\s+/.test(t)) {
      const n = t.match(/^function\s+([A-Za-z0-9_-]+)/);
      return n
        ? `Define PowerShell function ${n[1]}.`
        : "Define a PowerShell function.";
    }
    if (/^try\s*\{/.test(t)) return "Begin guarded block to catch runtime failures.";
    if (/^catch\b/.test(t)) return "Handle errors thrown in the preceding try block.";
    if (/^finally\b/.test(t)) return "Always run cleanup after try/catch completes.";
    if (/^throw\b/.test(t)) return "Abort this path by throwing an error.";
    if (t.length < 3) return null;
    return "Support the surrounding script logic for this step.";
  }

  if (/^import\s+type\b/.test(t))
    return "Import type-only dependency for typing without runtime cost.";
  if (/^import\s+/.test(t)) {
    const from = t.match(/from\s+["']([^"']+)["']/);
    return from
      ? `Import module dependency from ${from[1]}.`
      : "Import module dependency used by this file.";
  }
  if (/^export\s+\{/.test(t) && /from\s+/.test(t))
    return "Re-export selected symbols for a stable public barrel.";
  if (/^export\s+\*\s+from\b/.test(t))
    return "Re-export all module symbols through this barrel.";
  if (/^export\s+type\b/.test(t))
    return "Export type definition for consumers of this module.";
  if (/^export\s+default\b/.test(t))
    return "Default export of this module primary surface.";
  if (/^export\s+(async\s+)?function\b/.test(t)) {
    const n = t.match(/function\s+([A-Za-z0-9_]+)/);
    return n
      ? `Export function ${n[1]} as part of this module API.`
      : "Export function as part of this module API.";
  }
  if (/^export\s+(const|let|var|class|enum|interface)\b/.test(t)) {
    const n = t.match(
      /^export\s+(?:const|let|var|class|enum|interface)\s+([A-Za-z0-9_]+)/,
    );
    return n
      ? `Export ${n[1]} for use by other modules.`
      : "Export binding for use by other modules.";
  }

  if (/^(export\s+)?(async\s+)?function\b/.test(t)) {
    const n = t.match(/function\s+([A-Za-z0-9_]+)/);
    return n
      ? `Define function ${n[1]} and its behavior.`
      : "Define a function used by this module.";
  }
  if (/^(export\s+)?(abstract\s+)?class\b/.test(t)) {
    const n = t.match(/class\s+([A-Za-z0-9_]+)/);
    return n ? `Define class ${n[1]}.` : "Define a class used by this module.";
  }
  if (/^(export\s+)?interface\b/.test(t)) {
    const n = t.match(/interface\s+([A-Za-z0-9_]+)/);
    return n
      ? `Declare interface ${n[1]} shape.`
      : "Declare an interface shape.";
  }
  if (/^(export\s+)?type\b/.test(t)) {
    const n = t.match(/type\s+([A-Za-z0-9_]+)/);
    return n ? `Declare type alias ${n[1]}.` : "Declare a type alias.";
  }
  if (/^(export\s+)?enum\b/.test(t)) {
    const n = t.match(/enum\s+([A-Za-z0-9_]+)/);
    return n ? `Declare enum ${n[1]}.` : "Declare an enum.";
  }

  if (
    /^const\s+\[[^\]]+\]\s*=\s*useState\b/.test(t) ||
    (/\buseState\b/.test(t) && /const\s+/.test(t))
  )
    return "React state slot for local UI/data that can change over time.";
  if (/\buseEffect\s*\(/.test(t))
    return "Run side effects after render when dependencies change.";
  if (/\buseMemo\s*\(/.test(t))
    return "Memoize derived value to avoid recomputing every render.";
  if (/\buseCallback\s*\(/.test(t))
    return "Memoize callback identity for stable child/effect deps.";
  if (/\buseRef\s*\(/.test(t))
    return "Hold a mutable ref that persists across renders without re-render.";
  if (/\buseContext\s*\(/.test(t))
    return "Read shared context value from the nearest provider.";
  if (/\buseReducer\s*\(/.test(t))
    return "Manage complex state transitions via reducer actions.";
  if (/\buseNavigate\s*\(/.test(t))
    return "Access router navigate helper for programmatic navigation.";
  if (/\buseParams\s*\(/.test(t))
    return "Read route params from the current URL.";
  if (/\buseSearchParams\s*\(/.test(t))
    return "Read/write URL search params for filterable views.";
  if (/^const\s+\w+\s*=\s*use[A-Z]\w*\(/.test(t)) {
    const n = t.match(/=\s*(use[A-Z]\w*)/);
    return n
      ? `Invoke ${n[1]} hook for page/feature state and behavior.`
      : "Invoke a custom hook for feature behavior.";
  }

  if (/^if\s*\(/.test(t))
    return "Conditional branch for the case described by this guard.";
  if (/^else\s+if\s*\(/.test(t))
    return "Alternate branch when the previous guards did not match.";
  if (/^else\b/.test(t))
    return "Fallback branch when earlier conditions were false.";
  if (/^switch\s*\(/.test(t))
    return "Dispatch behavior based on a discrete value.";
  if (/^case\s+/.test(t)) return "Handle one specific switch case value.";
  if (/^default\s*:/.test(t)) return "Handle the default switch case.";
  if (/^for\s*\(/.test(t)) return "Iterate a collection or counted range.";
  if (/^while\s*\(/.test(t)) return "Loop while the condition remains true.";
  if (/^try\s*\{/.test(t))
    return "Begin guarded block to catch runtime failures.";
  if (/^catch\s*\(/.test(t))
    return "Handle errors thrown in the preceding try block.";
  if (/^finally\b/.test(t))
    return "Always run cleanup after try/catch completes.";
  if (/^throw\b/.test(t))
    return "Abort this path by throwing an error to callers.";
  if (/^return\s*\(\s*$/.test(t))
    return "Return the JSX/UI tree for this render path.";
  if (/^return\b/.test(t))
    return "Return early result or rendered output from this path.";
  if (/^await\b/.test(t))
    return "Wait for an async operation before continuing.";
  if (/^continue\b/.test(t)) return "Skip to the next loop iteration.";
  if (/^break\b/.test(t)) return "Exit the enclosing loop or switch.";

  if (/^(const|let|var)\s+/.test(t)) {
    if (
      /\bfetch\b|\.get\b|\.post\b|\.put\b|\.patch\b|\.delete\b|api\./i.test(t)
    )
      return "Capture remote/API result needed by this flow.";
    if (/\.map\s*\(/.test(t))
      return "Map source items into a derived list for rendering or logic.";
    if (/\.filter\s*\(/.test(t))
      return "Filter items down to those relevant for this view.";
    if (/\.find\s*\(/.test(t))
      return "Find the first matching item for this lookup.";
    if (/\.reduce\s*\(/.test(t))
      return "Reduce a collection into an aggregate value.";
    if (/JSON\.parse/.test(t))
      return "Parse JSON payload into a usable object.";
    if (/JSON\.stringify/.test(t))
      return "Serialize value to JSON for storage or transport.";
    if (/new\s+Set\b|new\s+Map\b/.test(t))
      return "Create a Set/Map for efficient membership or keyed lookup.";
    if (/=\s*\[/.test(t))
      return "Initialize an array used by subsequent logic.";
    if (/=\s*\{/.test(t))
      return "Initialize an object holding related fields.";
    const n = t.match(/^(?:const|let|var)\s+([A-Za-z0-9_]+)/);
    return n
      ? `Bind ${n[1]} for use in the following logic.`
      : "Bind a local value for the following logic.";
  }

  if (/^set[A-Z]\w*\(/.test(t))
    return "Update React state so the UI reflects the new value.";
  if (/\bdispatch\b/.test(t))
    return "Dispatch a state update for this feature.";
  if (/^void\s+/.test(t))
    return "Fire-and-forget async work without awaiting in this path.";
  if (/^console\.(log|warn|error|debug)\b/.test(t))
    return "Emit diagnostic output for debugging this path.";
  if (/^expect\s*\(/.test(t))
    return "Assert expected behavior in this test case.";
  if (/^describe\s*\(/.test(t))
    return "Group related tests under a shared suite name.";
  if (/^it\s*\(|^test\s*\(/.test(t))
    return "Define a single test case and its expectation.";
  if (
    /^beforeEach\s*\(|^afterEach\s*\(|^beforeAll\s*\(|^afterAll\s*\(/.test(t)
  )
    return "Register test lifecycle hook for setup or teardown.";
  if (/^vi\.|^jest\./.test(t))
    return "Configure test double / mock behavior for isolation.";

  if (/^[A-Za-z0-9_$]+\s*:/.test(t) && !/^https?:/.test(t)) {
    const n = t.match(/^([A-Za-z0-9_$]+)\s*:/);
    return n
      ? `Provide ${n[1]} field used by this structure.`
      : "Provide a field used by this structure.";
  }
  if (/^\.\.\./.test(t))
    return "Spread prior fields/items so overrides can layer cleanly.";

  if (/^<>/.test(t))
    return "Open a React fragment to group children without an extra DOM node.";
  if (/^<[A-Z]/.test(t)) {
    const n = t.match(/^<([A-Za-z0-9_.]+)/);
    return n
      ? `Render ${n[1]} as part of this view composition.`
      : "Render a component as part of this view.";
  }
  if (/^<[a-z]/.test(t)) {
    const n = t.match(/^<([a-z0-9-]+)/);
    return n
      ? `Render a <${n[1]}> element for layout or semantics.`
      : "Render a DOM element for layout or semantics.";
  }
  if (
    /^[A-Za-z_][\w.]*\s*=\s*\{/.test(t) ||
    /^[A-Za-z_][\w.]*\s*=\s*["'`]/.test(t)
  ) {
    const n = t.match(/^([A-Za-z_][\w.]*)\s*=/);
    return n
      ? `Pass ${n[1]} prop/value into the element or config.`
      : "Pass a prop/value into the element or config.";
  }
  if (/^on[A-Z]\w*\s*=/.test(t))
    return "Wire an event handler prop for user interaction.";
  if (/^className\s*=/.test(t))
    return "Apply CSS class names that style this element.";
  if (/^style\s*=/.test(t))
    return "Apply inline styles when class-based styling is insufficient.";
  if (/^key\s*=/.test(t))
    return "Supply a stable list key so React can reconcile items.";
  if (/^disabled\s*=/.test(t))
    return "Disable interaction while a busy/invalid condition holds.";
  if (/^type\s*=/.test(t))
    return "Set the element type attribute for correct browser behavior.";
  if (
    /^value\s*=/.test(t) ||
    /^checked\s*=/.test(t) ||
    /^defaultValue\s*=/.test(t)
  )
    return "Bind controlled/uncontrolled input value from component state.";
  if (/^placeholder\s*=/.test(t))
    return "Show placeholder text guiding user input.";
  if (/^aria-|^role\s*=|^tabIndex\s*=/.test(t))
    return "Set accessibility attribute for assistive tech.";
  if (/^data-/.test(t))
    return "Attach a data-* attribute for tests or styling hooks.";

  if (ext === ".css") {
    if (t.startsWith("@")) return "CSS at-rule configuring stylesheet behavior.";
    if (/^[.#\[]/.test(t) || /^[a-z].*\{/.test(t))
      return "Selector block styling matching elements.";
    if (/:/.test(t)) return "Declare a CSS property for the active rule.";
  }

  if (/^\./.test(t))
    return "Continue a chained call building on the previous expression.";
  if (/^[A-Za-z_][\w.]*\(/.test(t)) {
    const n = t.match(/^([A-Za-z_][\w.]*)/);
    return n
      ? `Invoke ${n[1]} to perform this step.`
      : "Invoke a function to perform this step.";
  }

  if (t.length < 3) return null;
  return "Support the surrounding logic for this step.";
}

function hasInlineAdequateComment(line, ext) {
  if (ext === ".css") return /\/\*.*\*\//.test(line);
  if (isShellExt(ext)) {
    // Trailing # comment after code (best-effort; ignore # inside quotes loosely)
    return /\s#\s+\S/.test(line);
  }
  const withoutStrings = line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
  return (
    /(?<!:)\/\/.+$/.test(withoutStrings) || /\/\*.+\*\//.test(withoutStrings)
  );
}

function isProbablyJsxOpenAt(line, i) {
  const c = line[i];
  const n = line[i + 1];
  if (c !== "<" || n == null) return false;
  if (!/[A-Za-z\/!]/.test(n)) return false;
  let j = i - 1;
  while (j >= 0 && (line[j] === " " || line[j] === "\t")) j--;
  if (j >= 0 && /[A-Za-z0-9_>$]/.test(line[j])) return false;
  return true;
}

function quotesAreCode(st) {
  return st.inOpenTag || st.jsxExprDepth > 0 || st.jsxChildrenDepth === 0;
}

function updateStateFromLine(line, ext, st) {
  if (ext === ".css") {
    let i = 0;
    while (i < line.length) {
      if (st.inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) return;
        st.inBlockComment = false;
        i = end + 2;
        continue;
      }
      if (line.startsWith("/*", i)) {
        st.inBlockComment = true;
        i += 2;
        continue;
      }
      i++;
    }
    return;
  }

  if (isShellExt(ext)) {
    // Shell: ignore # comments; track simple quotes for multiline safety
    const trimmed = line.trim();
    if (trimmed.startsWith("#") && !st.inSingle && !st.inDouble) return;
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (st.inSingle) {
        if (c === "'") st.inSingle = false;
        i++;
        continue;
      }
      if (st.inDouble) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') st.inDouble = false;
        i++;
        continue;
      }
      if (c === "#") break;
      if (c === "'") {
        st.inSingle = true;
        i++;
        continue;
      }
      if (c === '"') {
        st.inDouble = true;
        i++;
        continue;
      }
      i++;
    }
    return;
  }

  const trimmed = line.trim();
  if (
    trimmed.startsWith("//") &&
    !st.inSingle &&
    !st.inDouble &&
    !st.inTemplate &&
    !st.inBlockComment
  ) {
    return;
  }

  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const n = line[i + 1];

    if (st.inBlockComment) {
      if (c === "*" && n === "/") {
        st.inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (st.inSingle) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") st.inSingle = false;
      i++;
      continue;
    }
    if (st.inDouble) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') st.inDouble = false;
      i++;
      continue;
    }
    if (st.inTemplate && st.templateExprDepth === 0) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        st.inTemplate = false;
        i++;
        continue;
      }
      if (c === "$" && n === "{") {
        st.templateExprDepth = 1;
        st.braceDepth++;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (c === "/" && n === "/") break;
    if (c === "/" && n === "*") {
      st.inBlockComment = true;
      i += 2;
      continue;
    }

    if (quotesAreCode(st)) {
      if (c === "'") {
        st.inSingle = true;
        i++;
        continue;
      }
      if (c === '"') {
        st.inDouble = true;
        i++;
        continue;
      }
      if (c === "`") {
        st.inTemplate = true;
        st.templateExprDepth = 0;
        i++;
        continue;
      }
    }

    if (c === "{") {
      st.braceDepth++;
      if (st.inTemplate && st.templateExprDepth > 0) st.templateExprDepth++;
      if (st.jsxChildrenDepth > 0 && !st.inOpenTag) st.jsxExprDepth++;
      i++;
      continue;
    }
    if (c === "}") {
      if (st.braceDepth > 0) st.braceDepth--;
      if (st.inTemplate && st.templateExprDepth > 0) st.templateExprDepth--;
      if (st.jsxExprDepth > 0) st.jsxExprDepth--;
      i++;
      continue;
    }
    if (c === "(") {
      st.parenDepth++;
      i++;
      continue;
    }
    if (c === ")") {
      if (st.parenDepth > 0) st.parenDepth--;
      i++;
      continue;
    }
    if (c === "[") {
      st.bracketDepth++;
      i++;
      continue;
    }
    if (c === "]") {
      if (st.bracketDepth > 0) st.bracketDepth--;
      i++;
      continue;
    }

    if ((ext === ".tsx" || ext === ".jsx") && isProbablyJsxOpenAt(line, i)) {
      if (n === "/") {
        const close = line.indexOf(">", i);
        if (close !== -1) {
          if (st.jsxChildrenDepth > 0) st.jsxChildrenDepth--;
          st.inOpenTag = false;
          i = close + 1;
          continue;
        }
      }
      st.inOpenTag = true;
      const close = line.indexOf(">", i);
      if (close !== -1) {
        const selfClosing = line[close - 1] === "/";
        st.inOpenTag = false;
        if (!selfClosing) st.jsxChildrenDepth++;
        i = close + 1;
        continue;
      }
      i = line.length;
      continue;
    }

    if (st.inOpenTag && c === ">") {
      const selfClosing = i > 0 && line[i - 1] === "/";
      st.inOpenTag = false;
      if (!selfClosing) st.jsxChildrenDepth++;
      i++;
      continue;
    }

    i++;
  }
}

function formatComment(ind, text, ext) {
  if (ext === ".css") return `${ind}/* ${text} */`;
  if (isShellExt(ext)) return `${ind}# ${text}`;
  return `${ind}// ${text}`;
}

function annotateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.split(/\r?\n/);
  const hadTrailingNewline = original.endsWith("\n");
  const contentLines =
    hadTrailingNewline && lines.length && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;

  const out = [];
  let commentsAdded = 0;
  let skipped = 0;
  const skipReasons = [];
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

  const st = {
    inBlockComment: false,
    inSingle: false,
    inDouble: false,
    inTemplate: false,
    templateExprDepth: 0,
    jsxChildrenDepth: 0,
    jsxExprDepth: 0,
    inOpenTag: false,
    parenDepth: 0,
    braceDepth: 0,
    bracketDepth: 0,
  };

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];
    const trimmed = line.trim();

    const pre = {
      jsxChildrenDepth: st.jsxChildrenDepth,
      jsxExprDepth: st.jsxExprDepth,
      inOpenTag: st.inOpenTag,
      inString:
        st.inSingle ||
        st.inDouble ||
        (st.inTemplate && st.templateExprDepth === 0),
      inBlock: st.inBlockComment,
    };

    const alreadyCommented =
      (out.length > 0 && isCommentLine(out[out.length - 1], ext)) ||
      (i > 0 && isCommentLine(contentLines[i - 1], ext)) ||
      hasInlineAdequateComment(line, ext);

    let shouldSkip = false;
    let safetySkip = false;
    let reason = null;

    if (isBlank(line)) {
      shouldSkip = true;
      reason = "empty";
    } else if (isCommentLine(line, ext)) {
      shouldSkip = true;
      reason = "already-comment";
    } else if (pre.inBlock) {
      shouldSkip = true;
      reason = "inside-block-comment";
    } else if (pre.inString) {
      shouldSkip = true;
      safetySkip = true;
      reason = "inside-string-or-template";
    } else if (isPureClosing(line) || isJsxClosingTag(line)) {
      shouldSkip = true;
      reason = "pure-closing";
    } else if (alreadyCommented) {
      shouldSkip = true;
      reason = "has-adequate-comment";
    } else if (
      (ext === ".tsx" || ext === ".jsx") &&
      pre.jsxChildrenDepth > 0 &&
      pre.jsxExprDepth === 0 &&
      !pre.inOpenTag
    ) {
      shouldSkip = true;
      safetySkip = true;
      reason = "jsx-children-unsafe-for-slash-comment";
    } else if (isShellExt(ext) && /^#!/.test(trimmed)) {
      shouldSkip = true;
      reason = "shebang";
    }

    if (!shouldSkip) {
      const text = describe(line, ext);
      if (text) {
        const ind = indentOf(line);
        out.push(formatComment(ind, text, ext));
        commentsAdded++;
      } else {
        skipped++;
        skipReasons.push({
          file: rel,
          lineHint: trimmed.slice(0, 80),
          reason: "no-meaningful-comment",
        });
      }
    } else if (safetySkip) {
      skipped++;
      skipReasons.push({
        file: rel,
        lineHint: trimmed.slice(0, 80),
        reason,
      });
    }

    out.push(line);
    updateStateFromLine(line, ext, st);
  }

  let result = out.join("\n");
  if (hadTrailingNewline) result += "\n";

  const modified = result !== original;
  if (modified) {
    let oi = 0;
    for (const l of out) {
      if (oi < contentLines.length && l === contentLines[oi]) oi++;
      else if (!isCommentLine(l, ext) && l !== "") {
        throw new Error(
          `Non-comment mutation detected near: ${l.slice(0, 60)}`,
        );
      }
    }
    if (oi !== contentLines.length) {
      throw new Error(`Original lines missing after annotate in ${rel}`);
    }
    fs.writeFileSync(filePath, result, "utf8");
  }

  return { commentsAdded, skipped, skipReasons, modified };
}

function countGitCommentAdditions(fileList) {
  const args = fileList.map((f) => `"${f}"`).join(" ");
  let raw = "";
  try {
    raw = execSync(`git diff -U0 -- ${args}`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
    });
  } catch (e) {
    raw = e.stdout || "";
  }
  let count = 0;
  const files = new Set();
  let file = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      file = line.split(" ")[3]?.replace(/^b\//, "") ?? null;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (file) files.add(file);
      const c = line.slice(1).trim();
      const ext = path.extname(file || "").toLowerCase();
      if (
        c.startsWith("//") ||
        c.startsWith("/*") ||
        c.startsWith("*") ||
        c.endsWith("*/") ||
        c.startsWith("{/*") ||
        (isShellExt(ext) && c.startsWith("#")) ||
        c.startsWith("#")
      ) {
        count++;
      }
    }
  }
  return { count, filesModified: files.size };
}

function main() {
  const files = FILES.map((f) => path.resolve(f));
  let passComments = 0;
  let linesSkippedForSafety = 0;
  const skipReasons = [];
  const errors = [];
  let filesModifiedPass = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    try {
      if (!fs.existsSync(file)) {
        errors.push({ file: rel, message: "File not found" });
        continue;
      }
      const r = annotateFile(file);
      passComments += r.commentsAdded;
      linesSkippedForSafety += r.skipped;
      if (r.modified) filesModifiedPass++;
      for (const s of r.skipReasons) {
        if (skipReasons.length < 400) skipReasons.push(s);
      }
    } catch (e) {
      errors.push({
        file: rel,
        message: String(e && e.message ? e.message : e),
      });
    }
  }

  // Count only additions in this batch's files from the working tree vs HEAD
  // (includes prior partial comments); prefer pass comments for this run.
  const report = {
    batch: "remaining-b",
    filesInspected: FILES.length,
    filesModified: filesModifiedPass,
    commentsAdded: passComments,
    linesSkippedForSafety,
    skipReasons,
    errors,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
