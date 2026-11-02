/**
 * Isolated audit repro: H-WEB-02 (logic-level model of HousekeepingPage.refreshRoster).
 */
import assert from "node:assert/strict";

type RosterEntry = { employeeId: string; shiftId: string };

async function refreshRosterUnconditional(
  latencyMs: number,
  entries: RosterEntry[],
  apply: (draft: Record<string, string>) => void,
) {
  await new Promise((r) => setTimeout(r, latencyMs));
  const draft: Record<string, string> = {};
  for (const e of entries) draft[e.employeeId] = e.shiftId;
  apply(draft);
}

async function refreshRosterGuarded(
  latencyMs: number,
  entries: RosterEntry[],
  myGen: number,
  getGen: () => number,
  apply: (draft: Record<string, string>) => void,
) {
  await new Promise((r) => setTimeout(r, latencyMs));
  if (myGen !== getGen()) return;
  const draft: Record<string, string> = {};
  for (const e of entries) draft[e.employeeId] = e.shiftId;
  apply(draft);
}

async function main() {
  {
    let rosterDraft: Record<string, string> = {};
    const currentDate = "2099-01-02";
    const pA = refreshRosterUnconditional(
      40,
      [{ employeeId: "empA", shiftId: "shiftMorning" }],
      (d) => {
        rosterDraft = d;
      },
    );
    const pB = refreshRosterUnconditional(
      5,
      [{ employeeId: "empB", shiftId: "shiftEvening" }],
      (d) => {
        rosterDraft = d;
      },
    );
    await Promise.all([pA, pB]);

    console.log(
      JSON.stringify({
        currentDate,
        rosterDraft,
        draftMatchesB: rosterDraft.empB === "shiftEvening",
      }),
    );
    assert.deepEqual(rosterDraft, { empA: "shiftMorning" });
    console.log(
      "H-WEB-02 RESULT: STALE_DRAFT_APPLIED — late A overwrote B (matches unguarded refreshRoster)",
    );
  }

  {
    let gen = 0;
    let rosterDraft: Record<string, string> = {};
    const gA = ++gen;
    const pA = refreshRosterGuarded(
      40,
      [{ employeeId: "empA", shiftId: "shiftMorning" }],
      gA,
      () => gen,
      (d) => {
        rosterDraft = d;
      },
    );
    const gB = ++gen;
    const pB = refreshRosterGuarded(
      5,
      [{ employeeId: "empB", shiftId: "shiftEvening" }],
      gB,
      () => gen,
      (d) => {
        rosterDraft = d;
      },
    );
    await Promise.all([pA, pB]);
    assert.deepEqual(rosterDraft, { empB: "shiftEvening" });
    console.log("NEG_CONTROL_OK generation guard keeps B draft");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
