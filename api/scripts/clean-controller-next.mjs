import fs from "fs";
import path from "path";

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) acc.push(p);
  }
  return acc;
}

// Files/functions that must keep next()
const keepNextFiles = new Set([
  path.normalize("api/src/controllers/auth.ts"),
  path.normalize("api/src/controllers/attendance.ts"),
  path.normalize("api/src/controllers/events.ts"),
]);

for (const file of walk("api/src/controllers")) {
  if (file.endsWith(`${path.sep}events.ts`)) continue;

  let src = fs.readFileSync(file, "utf8");
  const orig = src;
  const nl = src.includes("\r\n") ? "\r\n" : "\n";

  // Strip settings-style redundant AppError+next catch (whole try/catch)
  src = src.replace(
    /  try \{\r?\n([\s\S]*?)\r?\n  \} catch \(err\) \{\r?\n    \/\/ Map known AppError to HTTP\.\r?\n    if \(err instanceof AppError\) return next\(err\);\r?\n    \/\/ Forward error to Express\.\r?\n    return next\(err\);\r?\n  \}/g,
    (_m, body) =>
      body
        .split(/\r?\n/)
        .map((l) => (l.startsWith("    ") ? l.slice(2) : l))
        .join(nl),
  );

  // Remove orphaned try-block comments
  src = src.replace(/^[ \t]*\/\/ Try block for fallible work\.\r?\n/gm, "");

  if (!keepNextFiles.has(path.normalize(file))) {
    src = src.replace(
      /\((req|_req): Request, res: Response, next: NextFunction\)/g,
      "($1: Request, res: Response)",
    );
    src = src.replace(
      /\((req|_req): Request,\r?\n  res: Response,\r?\n  next: NextFunction,\r?\n\)/g,
      `($1: Request,${nl}  res: Response,${nl})`,
    );
  } else {
    // attendance/auth: only strip next from handlers that no longer call next(
    const parts = src.split(/(?=^export async function )/m);
    src = parts
      .map((part) => {
        if (!part.startsWith("export async function ")) return part;
        if (/\bnext\s*\(/.test(part)) return part;
        return part
          .replace(
            /\((req|_req): Request, res: Response, next: NextFunction\)/,
            "($1: Request, res: Response)",
          )
          .replace(
            /\((req|_req): Request,\r?\n  res: Response,\r?\n  next: NextFunction,\r?\n\)/,
            `($1: Request,${nl}  res: Response,${nl})`,
          );
      })
      .join("");
  }

  // Clean NextFunction import if unused
  const bodyNoImport = src.replace(/import type \{[^}]+\} from "express";/, "");
  if (!/\bNextFunction\b/.test(bodyNoImport) && !/\bnext\s*\(/.test(bodyNoImport)) {
    src = src.replace(/import type \{([^}]+)\} from "express";/, (_m, inner) => {
      const parts = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && s !== "NextFunction");
      return parts.length
        ? `import type { ${parts.join(", ")} } from "express";`
        : "";
    });
  }

  // Clean AppError if unused
  const noAppImport = src.replace(
    /import \{[^}]*AppError[^}]*\} from "\.\.\/errors";/,
    "",
  );
  if (!/\bAppError\b/.test(noAppImport)) {
    src = src.replace(/import \{ AppError \} from "\.\.\/errors";\r?\n/, "");
  }

  if (src !== orig) {
    fs.writeFileSync(file, src);
    console.log("cleaned", file);
  }
}
