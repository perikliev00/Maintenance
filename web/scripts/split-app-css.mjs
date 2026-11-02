import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const srcPath = path.join(root, "App.css");
let lines = fs.readFileSync(srcPath, "utf8").split(/\r?\n/);

function findExact(trimEq) {
  return lines.findIndex((l) => l.trim() === trimEq);
}
function findIncludes(substr) {
  return lines.findIndex((l) => l.includes(substr));
}

const settingsIdx = [];
lines.forEach((l, i) => {
  if (l.trim() === ".settings-system {") settingsIdx.push(i);
});
if (settingsIdx.length >= 2) {
  const dupStart = settingsIdx[1];
  let dupEnd = dupStart;
  for (let i = dupStart; i < lines.length; i++) {
    if (
      lines[i].includes(".app-shell.density-compact table td") ||
      lines[i].includes(".app-shell.density-compact table th")
    ) {
      while (i < lines.length && lines[i].trim() !== "}") i++;
      dupEnd = i;
      while (dupEnd + 1 < lines.length && lines[dupEnd + 1].trim() === "") {
        dupEnd++;
      }
      break;
    }
  }
  lines.splice(dupStart, dupEnd - dupStart + 1);
  console.log("removed dup lines", dupEnd - dupStart + 1);
}

const aliasIdx = findIncludes("Backward-compatible alias");
if (aliasIdx >= 0) {
  let end = aliasIdx;
  for (let i = aliasIdx; i < lines.length; i++) {
    if (lines[i].trim().startsWith(".location-detail-panel")) {
      while (i < lines.length && lines[i].trim() !== "}") i++;
      end = i;
      continue;
    }
    if (
      i > aliasIdx &&
      lines[i].trim() &&
      !lines[i].trim().startsWith(".location-detail-panel") &&
      !lines[i].includes("Backward-compatible")
    ) {
      end = i - 1;
      break;
    }
    end = i;
  }
  while (end > aliasIdx && lines[end].trim() === "") end--;
  let removeCount = end - aliasIdx + 1;
  if (lines[aliasIdx + removeCount]?.trim() === "") removeCount++;
  lines.splice(aliasIdx, removeCount);
  console.log("removed alias lines", removeCount);
}

const outDir = path.join(root, "styles");
fs.mkdirSync(outDir, { recursive: true });

const idxLogin = findIncludes("/* ——— Login");
const idxShell = findIncludes("/* ——— App shell");
const idxModal = findExact(".modal-backdrop {");
const idxSettings = findExact(".settings-system {");
const idxDensity = findExact(".app-shell.density-compact .content {");
const idxPerm = findExact(".perm-matrix-wrap {");
const idxLive = findIncludes("/* Live board category semantics");
const idxMywork = findExact(".mywork-page {");
const idxRepairs = findExact(".repairs-grid {");
const idxLocDetail = findIncludes("Portaled to document.body");

console.log({
  idxLogin,
  idxShell,
  idxModal,
  idxSettings,
  idxDensity,
  idxPerm,
  idxLive,
  idxMywork,
  idxRepairs,
  idxLocDetail,
  total: lines.length,
});

function joinSlice(start, end) {
  return lines.slice(start, end).join("\n").trimEnd() + "\n";
}

const map = {
  "base.css": joinSlice(0, idxLogin),
  "login.css": joinSlice(idxLogin, idxShell),
  "shell.css":
    [...lines.slice(idxShell, idxModal), "", ...lines.slice(idxDensity, idxPerm)]
      .join("\n")
      .trimEnd() + "\n",
  "modals.css":
    [...lines.slice(idxModal, idxSettings), "", ...lines.slice(idxLocDetail)]
      .join("\n")
      .trimEnd() + "\n",
  "settings.css":
    [...lines.slice(idxSettings, idxDensity), "", ...lines.slice(idxPerm, idxLive)]
      .join("\n")
      .trimEnd() + "\n",
  "live-board.css": joinSlice(idxLive, idxMywork),
  "my-work.css": joinSlice(idxMywork, idxRepairs),
  "repairs.css": joinSlice(idxRepairs, idxLocDetail),
};

for (const [name, content] of Object.entries(map)) {
  fs.writeFileSync(path.join(outDir, name), content);
  console.log(name, content.split("\n").length);
}

const barrel = `/* Split from monolithic App.css — import order matters for cascade. */
@import "./styles/base.css";
@import "./styles/login.css";
@import "./styles/shell.css";
@import "./styles/modals.css";
@import "./styles/settings.css";
@import "./styles/live-board.css";
@import "./styles/my-work.css";
@import "./styles/repairs.css";
`;
fs.writeFileSync(srcPath, barrel);
console.log("App.css barrel written");
