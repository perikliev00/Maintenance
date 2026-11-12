const fs = require("fs");
const path = require("path");

const files = [
  "web/src/audit/labels.ts",
  "api/src/middleware/session.csrf.http.test.ts",
  "api/src/env.test.ts",
  "api/src/middleware/auth.requireAuth.test.ts",
  "web/src/app/routing.tsx",
  "web/src/audit/formatAuditDetails.ts",
  "web/src/app/App.tsx",
  "api/src/permissions.ts",
  "api/src/middleware/session.requireCsrf.test.ts",
  "api/src/events/authorizeLiveEvent.test.ts",
  "api/src/observability.ts",
  "api/src/middleware/auth.sseTicket.http.test.ts",
  "web/src/app/NavIcon.tsx",
  "scripts/ci/prepare-p1-test-db.sh",
  "scripts/verify-containers.mjs",
  "api/src/scripts/backfillAuditLocationIds.test.ts",
  "api/src/auth/sseTickets.ts",
  "api/src/app.health.test.ts",
];

function isComment(t, ext) {
  if (ext === ".sh") return t.startsWith("#");
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
      "})",
      "});",
      ">;",
      "</>",
    ].includes(t)
  )
    return true;
  if (/^[}\]\);,]+$/.test(t)) return true;
  return false;
}

function needsComment(lines, i, ext) {
  const t = lines[i].trim();
  if (isSkip(t)) return false;
  if (isComment(t, ext)) return false;
  if (/^<\/[A-Za-z]/.test(t)) return false;
  for (let j = i - 1; j >= 0; j--) {
    const prev = lines[j].trim();
    if (!prev) continue;
    if (isComment(prev, ext)) return false;
    return true;
  }
  return true;
}

for (const f of files) {
  const ext = path.extname(f);
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  let need = 0;
  const samples = [];
  for (let i = 0; i < lines.length; i++) {
    if (needsComment(lines, i, ext)) {
      need++;
      if (samples.length < 12) {
        samples.push({ line: i + 1, text: lines[i].trim().slice(0, 110) });
      }
    }
  }
  console.log(need + "\t" + f);
  for (const s of samples) console.log("   L" + s.line + ": " + s.text);
}
