// Import node:assert/strict for dailyPlanEffects/departure.test.ts.
import assert from "node:assert/strict";
// Import node:test for dailyPlanEffects/departure.test.ts.
import { describe, it } from "node:test";
// Import @prisma/client for dailyPlanEffects/departure.test.ts.
import { Occupancy } from "@prisma/client";
// Import ./departure for dailyPlanEffects/departure.test.ts.
import { classifyDepartureRoomEffects } from "./departure";

// Begin block/object for the following statements.
describe("classifyDepartureRoomEffects", () => {
  // Capture today for subsequent checks or writes.
  const today = "2026-10-09";

  // Begin block/object for the following statements.
  it("applies same-day occupied stay without newer-stay evidence (ignores cleaning)", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.occupied,
        // Carry this field through the payload or query.
        planYmd: today,
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: false,
        // Field value required by this payload or query.
        confirmed: false,
      }),
      // Execute: "apply",
      "apply",
    );
  });

  // Begin block/object for the following statements.
  it("protects when newer-stay evidence exists on same day", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.occupied,
        // Carry this field through the payload or query.
        planYmd: today,
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: true,
        // Field value required by this payload or query.
        confirmed: false,
      }),
      // Execute: "protect",
      "protect",
    );
  });

  // Begin block/object for the following statements.
  it("protects old departure when newer stay is proven (confirm does not override)", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.occupied,
        // Field value required by this payload or query.
        planYmd: "2026-10-07",
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: true,
        // Field value required by this payload or query.
        confirmed: true,
      }),
      // Execute: "protect",
      "protect",
    );
  });

  // Begin block/object for the following statements.
  it("defers past occupied departure without evidence", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.occupied,
        // Field value required by this payload or query.
        planYmd: "2026-10-07",
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: false,
        // Field value required by this payload or query.
        confirmed: false,
      }),
      // Execute: "defer",
      "defer",
    );
  });

  // Begin block/object for the following statements.
  it("applies past occupied departure after explicit confirmation", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.occupied,
        // Field value required by this payload or query.
        planYmd: "2026-10-07",
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: false,
        // Field value required by this payload or query.
        confirmed: true,
      }),
      // Execute: "apply",
      "apply",
    );
  });

  // Begin block/object for the following statements.
  it("applies when room is vacant regardless of plan age", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.vacant,
        // Field value required by this payload or query.
        planYmd: "2026-10-07",
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: false,
        // Field value required by this payload or query.
        confirmed: false,
      }),
      // Execute: "apply",
      "apply",
    );
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: Occupancy.vacant,
        // Carry this field through the payload or query.
        planYmd: today,
        // Carry this field through the payload or query.
        todayYmd: today,
        // Field value required by this payload or query.
        hasNewerStayEvidence: true,
        // Field value required by this payload or query.
        confirmed: false,
      }),
      // Execute: "apply",
      "apply",
    );
  });
});
