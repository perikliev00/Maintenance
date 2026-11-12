#!/usr/bin/env node
/**
 * Convert // comments wrongly placed in JSX element children to JSX block comments.
 * Keeps // when the comment sits inside a JS expression/paren (valid there).
 */
import fs from "node:fs";

const files = [
  "web/src/app/App.tsx",
  "web/src/app/routing.tsx",
  "web/src/app/NavIcon.tsx",
];

/**
 * Lightweight stack:
 * - "jsx" = inside element children (slash comments are text — convert)
 * - "expr" = inside { ... } JS expression (slash comments OK)
 * - "paren" = inside ( ... ) within an expression (slash comments OK)
 * - "tag" = inside an opening tag between attributes (slash comments OK)
 */
function fixFile(file) {
  const original = fs.readFileSync(file, "utf8");
  const lines = original.split(/\r?\n/);
  const hadNl = original.endsWith("\n");
  const content =
    hadNl && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;

  const stack = [];
  const out = [];
  let converted = 0;

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let templateExprDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;

  function top() {
    return stack[stack.length - 1] ?? null;
  }

  function feed(line) {
    inLineComment = false;
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const n = line[i + 1];

      if (inBlockComment) {
        if (c === "*" && n === "/") {
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
      if (inTemplate && templateExprDepth === 0) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "`") {
          inTemplate = false;
          i++;
          continue;
        }
        if (c === "$" && n === "{") {
          templateExprDepth = 1;
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      // In JS-ish contexts, quotes/comments work normally
      const jsCtx = top() === "expr" || top() === "paren" || top() === "tag" || top() == null;

      if (jsCtx || top() === "jsx") {
        if (c === "/" && n === "/" && (top() !== "jsx" || jsCtx)) {
          // only start line comment outside pure jsx-children text
          if (top() !== "jsx") {
            inLineComment = true;
            i += 2;
            continue;
          }
        }
        if (c === "/" && n === "*") {
          inBlockComment = true;
          i += 2;
          continue;
        }
      }

      if (jsCtx) {
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
      }

      if (templateExprDepth > 0) {
        if (c === "{") templateExprDepth++;
        if (c === "}") templateExprDepth--;
        i++;
        continue;
      }

      // JSX / structure tracking
      if (c === "<" && n && /[A-Za-z\/!]/.test(n)) {
        // closing tag
        if (n === "/") {
          const close = line.indexOf(">", i);
          if (close !== -1) {
            if (top() === "jsx") stack.pop();
            i = close + 1;
            continue;
          }
        }
        // opening tag
        stack.push("tag");
        const close = line.indexOf(">", i);
        if (close !== -1) {
          const selfClosing = line[close - 1] === "/";
          stack.pop(); // leave tag
          if (!selfClosing && n !== "!") {
            // enter element children (fragment/elements)
            if (!/^<>|^<Fragment\b/i.test(line.slice(i)) && n !== "!") {
              // detect fragment <> 
            }
            const tagChunk = line.slice(i, close + 1);
            if (!tagChunk.startsWith("</") && !/\/>$/.test(tagChunk) && !tagChunk.startsWith("<!")) {
              stack.push("jsx");
            }
          }
          i = close + 1;
          continue;
        }
        i = line.length;
        continue;
      }

      if (top() === "tag" && c === ">") {
        const selfClosing = i > 0 && line[i - 1] === "/";
        stack.pop();
        if (!selfClosing) stack.push("jsx");
        i++;
        continue;
      }

      if (c === "{" && top() === "jsx") {
        stack.push("expr");
        i++;
        continue;
      }
      if (c === "}" && top() === "expr") {
        stack.pop();
        i++;
        continue;
      }
      if (c === "(" && (top() === "expr" || top() === "paren")) {
        stack.push("paren");
        i++;
        continue;
      }
      if (c === ")" && top() === "paren") {
        stack.pop();
        i++;
        continue;
      }

      i++;
    }
  }

  for (const line of content) {
    const trimmed = line.trim();
    const ctx = top();

    if (trimmed.startsWith("//") && ctx === "jsx") {
      const ind = line.match(/^[ \t]*/)?.[0] ?? "";
      const text = trimmed.replace(/^\/\/\s?/, "");
      // Escape if comment would break JSX block comment
      const safe = text.replace(/\*\//g, "* /");
      out.push(`${ind}{/* ${safe} */}`);
      converted++;
      // Do not feed converted comment as code into the stack
      continue;
    }

    out.push(line);
    feed(line);
  }

  let result = out.join("\n");
  if (hadNl) result += "\n";
  if (result !== original) fs.writeFileSync(file, result, "utf8");
  return converted;
}

for (const f of files) {
  console.log(f, "converted", fixFile(f));
}
