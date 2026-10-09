import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Occupancy } from "@prisma/client";
import { classifyDepartureRoomEffects } from "./dailyPlan";

describe("classifyDepartureRoomEffects", () => {
  const today = "2026-10-09";

  it("applies same-day occupied stay without newer-stay evidence (ignores cleaning)", () => {
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: today,
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: false,
      }),
      "apply",
    );
  });

  it("protects when newer-stay evidence exists on same day", () => {
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: today,
        todayYmd: today,
        hasNewerStayEvidence: true,
        confirmed: false,
      }),
      "protect",
    );
  });

  it("protects old departure when newer stay is proven (confirm does not override)", () => {
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: true,
        confirmed: true,
      }),
      "protect",
    );
  });

  it("defers past occupied departure without evidence", () => {
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: false,
      }),
      "defer",
    );
  });

  it("applies past occupied departure after explicit confirmation", () => {
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.occupied,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: true,
      }),
      "apply",
    );
  });

  it("applies when room is vacant regardless of plan age", () => {
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.vacant,
        planYmd: "2026-10-07",
        todayYmd: today,
        hasNewerStayEvidence: false,
        confirmed: false,
      }),
      "apply",
    );
    assert.equal(
      classifyDepartureRoomEffects({
        occupancy: Occupancy.vacant,
        planYmd: today,
        todayYmd: today,
        hasNewerStayEvidence: true,
        confirmed: false,
      }),
      "apply",
    );
  });
});
