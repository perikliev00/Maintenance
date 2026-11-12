/**
 * Audit-only pure simulations for Live Board refresh / busy / permissions.
 * Does not import or mutate LiveBoardPage implementation internals beyond
 * exported helpers and shared busyIds — proves expected contracts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBusyId, isBusy, removeBusyId } from "./locations/busyIds";
import {
  canCompleteFromLiveBoard,
  needTitle,
  shouldApplyLiveSnapshot,
} from "./liveBoardLogic";
import { panelForLocationKind } from "../app/boardFocus";

describe("audit: live board refresh generation contract", () => {
  it("late stale GET generation must not apply after forced post-complete refresh", async () => {
    let currentGen = 0;
    let activeSessions: string[] = ["session-old"];

    // Define function applySnapshot and its behavior.
    async function applySnapshot(
      responseGen: number,
      payload: { activeSessions: string[] },
    ) {
      if (!shouldApplyLiveSnapshot(responseGen, currentGen)) return;
      activeSessions = payload.activeSessions;
    }

    // Slow GET started before complete.
    const staleGen = ++currentGen;
    let resolveStale!: (v: { activeSessions: string[] }) => void;
    const staleFetch = new Promise<{ activeSessions: string[] }>((resolve) => {
      resolveStale = resolve;
    });

    // Complete succeeds; force refresh bumps generation.
    const freshGen = ++currentGen;
    await applySnapshot(freshGen, { activeSessions: [] });
    assert.deepEqual(activeSessions, []);

    // Late stale GET arrives with the completed session still listed.
    resolveStale({ activeSessions: ["session-old"] });
    const stalePayload = await staleFetch;
    await applySnapshot(staleGen, stalePayload);

    assert.deepEqual(
      activeSessions,
      [],
      "stale GET must not restore a completed session after a newer refresh",
    );
  });
});

describe("audit: parallel busy tracking", () => {
  it("finishing A must not unlock B; double-begin on same id is rejected", () => {
    let busy = new Set<string>();
    const begin = (id: string) => {
      if (isBusy(busy, id)) return false;
      busy = addBusyId(busy, id);
      return true;
    };
    const end = (id: string) => {
      busy = removeBusyId(busy, id);
    };

    assert.equal(begin("A"), true);
    assert.equal(begin("B"), true);
    assert.equal(begin("A"), false);

    end("A");
    assert.equal(isBusy(busy, "A"), false);
    assert.equal(isBusy(busy, "B"), true);
    end("B");
    assert.equal(isBusy(busy, "B"), false);
  });
});

describe("audit: complete permission matrix", () => {
  const cases: Array<{
    actions: string[];
    expectUiComplete: boolean;
    expectApiAllowed: boolean;
  }> = [
    { actions: [], expectUiComplete: false, expectApiAllowed: false },
    {
      actions: ["cleaning.review_overdue"],
      expectUiComplete: false,
      expectApiAllowed: false,
    },
    {
      actions: ["cleaning.complete"],
      expectUiComplete: true,
      expectApiAllowed: true,
    },
    {
      actions: ["cleaning.complete", "cleaning.review_overdue"],
      expectUiComplete: true,
      expectApiAllowed: true,
    },
  ];

  for (const c of cases) {
    it(`actions=${JSON.stringify(c.actions)}`, () => {
      const ui = canCompleteFromLiveBoard(c.actions);
      // API contract mirrored: only cleaning.complete authorizes POST complete.
      const api = c.actions.includes("cleaning.complete");
      assert.equal(ui, c.expectUiComplete);
      assert.equal(api, c.expectApiAllowed);
      assert.equal(ui, api, "UI and API complete gates must stay aligned");
    });
  }
});

describe("audit: localization and navigation contracts", () => {
  it("BG titles do not embed room numbers", () => {
    const inspection = needTitle(
      {
        kind: "awaiting_inspection",
        titleKey: "inspection_needed",
        title: "Inspection needed",
      },
      "bg",
    );
    const pastDue = needTitle(
      { kind: "past_due", titleKey: "past_due", title: "Past due" },
      "bg",
    );
    assert.equal(inspection.includes("101"), false);
    assert.equal(pastDue.includes("101"), false);
    assert.match(inspection, /инспекция/i);
  });

  it("room vs common_area map to distinct panels", () => {
    assert.equal(panelForLocationKind("room"), "rooms");
    assert.equal(panelForLocationKind("common_area"), "common");
  });
});
