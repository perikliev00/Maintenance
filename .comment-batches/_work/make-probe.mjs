import fs from "node:fs";

const src = fs.readFileSync(".comment-batches/tools/annotate-remaining-b.mjs", "utf8");
const patched = src
  .replace(
    /const FILES = \[[\s\S]*?\];/,
    `const FILES = [
  "web/src/app/App.tsx",
  "web/src/app/NavIcon.tsx",
  "scripts/verify-containers.mjs",
  "web/src/app/routing.tsx",
  "web/src/app/useAuthBootstrap.ts",
];`,
  )
  .replace("remaining-b.json", "remaining-b-probe.json");
fs.writeFileSync(".comment-batches/_work/annotate-probe.mjs", patched);
console.log("wrote probe");
