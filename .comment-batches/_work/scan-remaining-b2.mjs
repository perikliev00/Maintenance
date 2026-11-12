import fs from "node:fs";
import path from "node:path";

const FILES = JSON.parse(
  fs.readFileSync(".comment-batches/tools/annotate-remaining-b.mjs", "utf8")
    .match(/const FILES = (\[[\s\S]*?\]);/)[1]
    .replace(/'/g, '"'),
);

function isComment(t, ext) {
  if (!t) return false;
  if (ext === ".css")
    return t.startsWith("/*") || t.startsWith("*") || t.startsWith("//") || t.endsWith("*/");
  if (ext === ".sh" || ext === ".ps1") return t.startsWith("#");
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.endsWith("*/") ||
    t.startsWith("{/*") ||
    t.startsWith("#")
  );
}

function isSkip(t) {
  if (!t) return true;
  if (
    [
      "{",
      "}",
      "};",
      "},",
      ");",
      "]",
      "],",
      "/>",
      ">",
      ")}",
      "});",
      ">;",
      ")",
      "),",
    ].includes(t)
  )
    return true;
  if (/^[}\]\);,{]+$/.test(t)) return true;
  if (/^<\//.test(t)) return true;
  return false;
}

function hasInline(line, ext) {
  if (ext === ".css") return /\/\*.*\*\//.test(line);
  if (ext === ".sh" || ext === ".ps1") return /\s#\s+\S/.test(line);
  const withoutStrings = line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
  return /(?<!:)\/\/.+$/.test(withoutStrings) || /\/\*.+\*\//.test(withoutStrings);
}

function needs(lines, i, ext) {
  const t = lines[i].trim();
  if (isSkip(t) || isComment(t, ext) || hasInline(lines[i], ext)) return false;
  for (let j = i - 1; j >= 0; j--) {
    const p = lines[j].trim();
    if (!p) continue;
    if (isComment(p, ext)) return false;
    return true;
  }
  return true;
}

let total = 0;
const needy = [];
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const ext = path.extname(f);
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  let n = 0;
  const samples = [];
  for (let i = 0; i < lines.length; i++) {
    if (needs(lines, i, ext)) {
      n++;
      if (samples.length < 2) samples.push(`L${i + 1}:${lines[i].trim().slice(0, 60)}`);
    }
  }
  total += n;
  if (n) {
    needy.push(f);
    console.log(`${n}\t${f}\n  ${samples.join("\n  ")}`);
  }
}
console.log("TOTAL_NEED", total);
console.log("NEEDY_FILES", needy.length);
fs.writeFileSync(
  ".comment-batches/_work/remaining-b-needy.json",
  JSON.stringify(needy, null, 2),
);
