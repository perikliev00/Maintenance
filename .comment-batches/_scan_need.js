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
    else if (/\.(ts|tsx|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

let files = [];
for (const r of roots) walk(r, files);
for (const e of extras) if (fs.existsSync(e)) files.push(e);
files = [...new Set(files)].sort();

function isComment(t, ext) {
  if (ext === ".css")
    return (
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.endsWith("*/") ||
      t.startsWith("//")
    );
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.endsWith("*/")
  );
}

function isSkip(t) {
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
    t === ">;"
  )
    return true;
  if (/^[}\]\);,]+$/.test(t)) return true;
  return false;
}

function needsComment(lines, i, ext) {
  const t = lines[i].trim();
  if (isSkip(t)) return false;
  if (isComment(t, ext)) return false;
  for (let j = i - 1; j >= 0; j--) {
    const prev = lines[j].trim();
    if (!prev) continue;
    if (isComment(prev, ext)) return false;
    return true;
  }
  return true;
}

let totalNeed = 0;
const report = [];
for (const f of files) {
  const ext = path.extname(f);
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  let need = 0;
  const samples = [];
  for (let i = 0; i < lines.length; i++) {
    if (needsComment(lines, i, ext)) {
      need++;
      if (samples.length < 3) samples.push({ line: i + 1, text: lines[i].trim().slice(0, 80) });
    }
  }
  totalNeed += need;
  report.push({ f, need, lines: lines.length, samples });
}
report.sort((a, b) => b.need - a.need);
console.log("files", files.length, "totalNeedApprox", totalNeed);
for (const r of report.filter((x) => x.need > 0).slice(0, 60)) {
  console.log(r.need + "\t" + r.f);
  for (const s of r.samples) console.log("   L" + s.line + ": " + s.text);
}
console.log("--- zero ---", report.filter((r) => r.need === 0).length);
