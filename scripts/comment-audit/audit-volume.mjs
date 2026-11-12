import fs from "node:fs";
import path from "node:path";

const roots = ["api/src", "api/tests", "api/scripts", "api/prisma", "web/src", "e2e", "scripts"];
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function walk(d, a = []) {
  if (!fs.existsSync(d)) return a;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) walk(p, a);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) a.push(p);
  }
  return a;
}

let files = 0;
let totalLines = 0;
let fullLineComments = 0;
const samples = new Map();

for (const r of roots) {
  for (const f of walk(r)) {
    files++;
    const lines = fs.readFileSync(f, "utf8").split(/\n/);
    totalLines += lines.length;
    for (const line of lines) {
      const m = line.match(/^\s*\/\/\s*(.*)$/);
      if (!m) continue;
      fullLineComments++;
      const k = m[1].trim().slice(0, 100);
      samples.set(k, (samples.get(k) || 0) + 1);
    }
  }
}

const top = [...samples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
console.log(JSON.stringify({ files, totalLines, fullLineComments, top }, null, 2));
