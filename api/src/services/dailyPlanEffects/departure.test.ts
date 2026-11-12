// Import node:assert/strict for dailyPlanEffects/departure.test.ts.
import assert from "node:assert/strict";
// Import node:test for dailyPlanEffects/departure.test.ts.
import { describe, it } from "node:test";
// Import @prisma/client for dailyPlanEffects/departure.test.ts.
import { Occupancy } from "@prisma/client";
// Import ./departure for dailyPlanEffects/departure.test.ts.
import { classifyDepartureRoomEffects } from "./departure";

describe("classifyDepartureRoomEffects", () => {
  const today = "2026-10-09";

  it("applies same-day occupied stay without newer-stay evidence (ignores cleaning)", () => {
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: today,
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: false,
      }),
      // Execute: "apply",
      "apply",
    );
  });

  it("protects when newer-stay evidence exists on same day", () => {
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: today,
        todayYmd: today,
        hasNewerStayEvidence: true,
        confirmed: false,
      }),
      // Execute: "protect",
      "protect",
    );
  });

  it("protects old departure when newer stay is proven (confirm does not override)", () => {
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: true,
        confirmed: true,
      }),
      // Execute: "protect",
      "protect",
    );
  });

  it("defers past occupied departure without evidence", () => {
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: false,
      }),
      // Execute: "defer",
      "defer",
    );
  });

  it("applies past occupied departure after explicit confirmation", () => {
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: true,
      }),
      // Execute: "apply",
      "apply",
    );
  });

  it("applies when room is vacant regardless of plan age", () => {
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.vacant,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: false,
      }),
      // Execute: "apply",
      "apply",
    );
    // Execute: assert.equal(
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.vacant,
        planYmd: today,
        todayYmd: today,
        hasNewerStayEvidence: true,
        confirmed: false,
      }),
      // Execute: "apply",
      "apply",
    );
  });
});
