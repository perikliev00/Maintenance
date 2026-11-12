import { execSync } from "node:child_process";
import fs from "node:fs";

const files = [
  "api/src/services/analytics/housekeepingSummary.ts",
  "api/src/services/analytics/forecast.test.ts",
  "api/src/services/analytics/stats.test.ts",
  "api/src/services/analytics/period.test.ts",
  "api/src/services/analytics/period.ts",
  "api/src/services/analytics/maintenanceSummary.ts",
  "api/src/services/analytics/riskRooms.ts",
  "api/src/services/analytics/sessionThresholds.ts",
  "api/src/services/analytics/locationLabel.ts",
  "api/src/services/analytics/forecast.ts",
  "api/src/services/analytics/stats.ts",
  "api/src/services/analytics/index.ts",
  "api/src/services/analytics/types.ts",
  "api/src/services/attendance/rebuild.ts",
  "api/src/services/attendance/notificationOutbox.ts",
  "api/src/services/attendance/adjustments.ts",
  "api/src/services/attendance/stale.test.ts",
  "api/src/services/attendance/reports/csv.test.ts",
  "api/src/services/attendance/reports/pagination.test.ts",
  "api/src/services/attendance/rebuild.test.ts",
  "api/src/services/attendance/index.ts",
  "api/src/services/attendance/reports/map.ts",
  "api/src/services/attendance/reports/query.ts",
  "api/src/services/attendance/reports/pagination.ts",
  "api/src/services/attendance/ingest.ts",
  "api/src/services/attendance/reports/csv.ts",
  "api/src/services/attendance/reports/index.ts",
  "api/src/services/audit.ts",
  "api/src/services/audit.producers.ts",
  "api/src/services/audit.producers.test.ts",
  "api/src/services/audit.write.test.ts",
  "api/src/services/audit.scope.test.ts",
  "api/src/services/authLogin.ts",
  "api/src/services/authProfile.ts",
  "api/src/services/authSessions.ts",
  "api/src/services/authSessions.assert.test.ts",
  "api/src/services/authSessions.rotateRefresh.test.ts",
  "api/src/services/authorization/assigneeBypass.ts",
  "api/src/services/assignees.ts",
  "api/src/services/assignees.test.ts",
  "api/src/services/attendanceRules.ts",
  "api/src/services/attendanceRules.test.ts",
  "api/src/services/cards/index.ts",
  "api/src/services/cards.filter.test.ts",
];

function isComment(l) {
  const t = l.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

let bad = 0;
let added = 0;
for (const f of files) {
  const head = execSync(`git show HEAD:${f}`, { encoding: "utf8" });
  const cur = fs.readFileSync(f, "utf8");
  const h = head.split(/\r?\n/);
  const c = cur.split(/\r?\n/);
  if (h[h.length - 1] === "") h.pop();
  if (c[c.length - 1] === "") c.pop();
  const hCode = h.filter((l) => !isComment(l));
  const cCode = c.filter((l) => !isComment(l));
  added += c.filter((l) => /^\s*\/\//.test(l)).length - h.filter((l) => /^\s*\/\//.test(l)).length;
  if (hCode.length !== cCode.length) {
    console.log("LEN", f, hCode.length, cCode.length);
    bad++;
    continue;
  }
  for (let i = 0; i < hCode.length; i++) {
    if (hCode[i] !== cCode[i]) {
      console.log("DIFF", f, i, JSON.stringify(hCode[i]), "=>", JSON.stringify(cCode[i]));
      bad++;
      break;
    }
  }
}
console.log(JSON.stringify({ ok: bad === 0, bad, approxNewSlashComments: added }));
