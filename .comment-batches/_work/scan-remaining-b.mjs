import fs from "node:fs";
import path from "node:path";

const FILES = [
  "api/src/scripts/backfillAuditLocationIds.test.ts",
  "api/src/scripts/backfillAuditLocationIds.ts",
  "api/src/services/cleaning/idempotency.ts",
  "api/src/startup/requiredDefaults.ts",
  "api/src/startup/requiredDefaults.wiring.test.ts",
  "api/src/errors.ts",
  "api/tests/proveP1Isolation.mjs",
  "api/tests/proveP1Isolation.negative.mjs",
  "api/tests/proveP1Isolation.worker.mjs",
  "api/tests/registerP1TestEnv.mjs",
  "api/tests/runWithP1Isolation.mjs",
  "api/tests/_iso_worker_probe.mjs",
  "web/src/app/App.tsx",
  "web/src/app/boardFocus.test.ts",
  "web/src/app/boardFocus.ts",
  "web/src/app/index.ts",
  "web/src/app/NavIcon.tsx",
  "web/src/app/routing.tsx",
  "web/src/app/useAuthBootstrap.ts",
  "web/src/audit/formatAuditDetails.ts",
  "web/src/audit/labels.test.ts",
  "web/src/audit/labels.ts",
  "web/src/pages/myWork/index.ts",
  "web/src/pages/plan/index.ts",
  "web/src/pages/SettingsPage/index.tsx",
  "web/src/pages/team/labels.ts",
  "web/src/pages/CommonAreasPage.tsx",
  "web/src/pages/LocationsPage.tsx",
  "web/src/pages/MyWorkPage.tsx",
  "web/src/pages/PlanPage.tsx",
  "web/src/pages/RoomsPage.tsx",
  "web/src/i18n.ts",
  "web/src/index.css",
  "web/src/saveRefresh.test.ts",
  "web/src/saveRefresh.ts",
  "web/src/theme.ts",
  "web/src/vite-env.d.ts",
  "scripts/ci/prepare-p1-test-db.sh",
  "scripts/run-local-restore-drill.ps1",
  "scripts/run-local-restore-drill.sh",
  "scripts/verify-containers.mjs",
  "web/src/pages/SettingsPage/InterfaceTab.tsx",
  "api/src/permissions.roleAssignment.test.ts",
  "api/src/auth/tokens.test.ts",
];

function isComment(t, ext) {
  if (!t) return false;
  if (ext === ".css")
    return (
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.startsWith("//") ||
      t.endsWith("*/")
    );
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
    t === "{" ||
    t === "}" ||
    t === "};" ||
    t === "}," ||
    t === ");" ||
    t === "]" ||
    t === "]," ||
    t === "/>" ||
    t === ">" ||
    t === ")}" ||
    t === "});" ||
    t === ">;" ||
    t === ")" ||
    t === "),"
  )
    return true;
  if (/^[}\]\);,{]+$/.test(t)) return true;
  if (/^<\//.test(t)) return true;
  return false;
}

function needs(lines, i, ext) {
  const t = lines[i].trim();
  if (isSkip(t) || isComment(t, ext)) return false;
  for (let j = i - 1; j >= 0; j--) {
    const p = lines[j].trim();
    if (!p) continue;
    if (isComment(p, ext)) return false;
    return true;
  }
  return true;
}

let total = 0;
for (const f of FILES) {
  const ext = path.extname(f);
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  let n = 0;
  const samples = [];
  for (let i = 0; i < lines.length; i++) {
    if (needs(lines, i, ext)) {
      n++;
      if (samples.length < 3)
        samples.push(`L${i + 1}:${lines[i].trim().slice(0, 70)}`);
    }
  }
  total += n;
  if (n)
    console.log(`${n}\t${f}\n  ${samples.join("\n  ")}`);
}
console.log("TOTAL_NEED", total);
