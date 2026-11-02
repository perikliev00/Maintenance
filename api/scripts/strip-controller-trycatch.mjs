import fs from "fs";
import path from "path";

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const SKIP_FILES = new Set([
  path.normalize("api/src/controllers/events.ts"),
]);

const files = walk("api/src/controllers").filter(
  (f) => !SKIP_FILES.has(path.normalize(f)),
);

function isSimpleForwardCatch(catchBlock) {
  const normalized = catchBlock.replace(/\r\n/g, "\n").trim();
  const patterns = [
    /^\} catch \(err\) \{\n(?:    \/\/ Forward error to Express\.\n)?(?:    \/\/ Map known AppError to HTTP\.\n)?(?:    if \(err instanceof AppError\) return next\(err\);\n)?    return next\(err\);\n  \}$/,
    /^\} catch \(err\) \{\n(?:    \/\/ Forward error to Express\.\n)?    next\(err\);\n  \}$/,
    /^\} catch \(err\) \{\n    return next\(err\);\n  \}$/,
  ];
  return patterns.some((re) => re.test(normalized));
}

let totalRemoved = 0;

for (const file of files) {
  const orig = fs.readFileSync(file, "utf8");
  const nl = orig.includes("\r\n") ? "\r\n" : "\n";
  const lines = orig.split(/\r?\n/);
  const out = [];
  let i = 0;
  let removed = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!/^  try \{$/.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    let depth = 0;
    const tryStart = i;
    let catchStart = -1;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }
      if (j > tryStart && depth === 1 && /^\s*\} catch \(err\) \{/.test(lines[j])) {
        catchStart = j;
        break;
      }
      if (j > tryStart && depth === 0) break;
    }

    if (catchStart === -1) {
      out.push(line);
      i++;
      continue;
    }

    // Catch block body is between catchStart and the next line that is exactly "  }"
    // (function-body indentation). Avoid brace-counting the "} catch {" line.
    let catchEnd = -1;
    for (let k = catchStart + 1; k < lines.length; k++) {
      if (lines[k] === "  }") {
        catchEnd = k;
        break;
      }
      // Nested blocks inside catch are unexpected for our simple pattern; abort.
      if (/^  (export |async |function |\/\*\*|\/\/)/.test(lines[k])) break;
    }
    if (catchEnd === -1) {
      out.push(line);
      i++;
      continue;
    }

    const catchBlock = lines.slice(catchStart, catchEnd + 1).join("\n");

    let fnHeader = "";
    for (let b = tryStart; b >= 0; b--) {
      if (/^export async function /.test(lines[b])) {
        fnHeader = lines[b];
        break;
      }
    }
    const keepFn = /export async function (refresh|logout)\(/.test(fnHeader);

    if (!isSimpleForwardCatch(catchBlock) || keepFn) {
      out.push(line);
      i++;
      continue;
    }

    const body = lines.slice(tryStart + 1, catchStart);
    for (const bl of body) {
      out.push(bl.startsWith("    ") ? bl.slice(2) : bl);
    }
    removed++;
    i = catchEnd + 1;
  }

  let result = out.join(nl);

  // Drop unused next: NextFunction params.
  result = result.replace(
    /\(req: Request, res: Response, next: NextFunction\)/g,
    (match, offset) => {
      const rest = result.slice(offset);
      const end = rest.search(/\nexport |\n\/\*\*[^*]|\n$/);
      const body = end === -1 ? rest : rest.slice(0, end);
      const uses = (body.match(/\bnext\s*\(/g) || []).length;
      return uses === 0 ? "(req: Request, res: Response)" : match;
    },
  );

  // Also multiline signatures: next: NextFunction,\n)
  result = result.replace(
    /\(req: Request,\n  res: Response,\n  next: NextFunction,\n\)/g,
    (match, offset) => {
      const rest = result.slice(offset);
      const end = rest.search(/\nexport |\n\/\*\*/);
      const body = end === -1 ? rest.slice(0, 2000) : rest.slice(0, end);
      const uses = (body.match(/\bnext\s*\(/g) || []).length;
      return uses === 0 ? "(req: Request,\n  res: Response,\n)" : match;
    },
  );

  // Clean NextFunction from import if unused in file body.
  const withoutImport = result.replace(/import type \{[^}]+\} from "express";/, "");
  if (!withoutImport.includes("NextFunction")) {
    result = result.replace(/import type \{([^}]+)\} from "express";/, (_m, inner) => {
      const parts = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && s !== "NextFunction");
      if (parts.length === 0) return "";
      return `import type { ${parts.join(", ")} } from "express";`;
    });
  }

  // Drop unused AppError import if no longer referenced.
  if (
    result.includes('from "../errors"') ||
    result.includes("from \"../errors\"")
  ) {
    const noImport = result.replace(/import \{[^}]*AppError[^}]*\} from "\.\.\/errors";\n?/, "");
    if (!/\bAppError\b/.test(noImport)) {
      result = result.replace(/import \{ AppError \} from "\.\.\/errors";\n/, "");
      result = result.replace(/import \{([^}]+)\} from "\.\.\/errors";/, (_m, inner) => {
        const parts = inner
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s !== "AppError");
        if (parts.length === 0) return "";
        return `import { ${parts.join(", ")} } from "../errors";`;
      });
    }
  }

  if (result !== orig) {
    fs.writeFileSync(file, result);
    console.log(`updated ${file} (-${removed} try/catch)`);
    totalRemoved += removed;
  } else {
    console.log(`unchanged ${file}`);
  }
}

console.log(`TOTAL removed ${totalRemoved}`);
