// Import node:assert/strict for cleaning/deriveServiceType.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/deriveServiceType.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  CleaningServiceType,
  // Carry this field through the payload or query.
  DailyPlanCategory,
  // Carry this field through the payload or query.
  LocationKind,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ./deriveServiceType for cleaning/deriveServiceType.test.ts.
import { deriveCleaningServiceType } from "./deriveServiceType";

// Begin block/object for the following statements.
describe("deriveCleaningServiceType", () => {
  // Begin block/object for the following statements.
  it("returns explicit serviceType when provided", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      deriveCleaningServiceType({
        // Carry this field through the payload or query.
        locationKind: LocationKind.room,
        // Carry this field through the payload or query.
        serviceType: CleaningServiceType.departure,
        // Carry this field through the payload or query.
        planCategory: DailyPlanCategory.arrival,
      }),
      // Execute: CleaningServiceType.departure,
      CleaningServiceType.departure,
    );
  });

  // Begin block/object for the following statements.
  it("returns common_area for non-room locations", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      deriveCleaningServiceType({
        // Carry this field through the payload or query.
        locationKind: LocationKind.common_area,
        // Carry this field through the payload or query.
        planCategory: DailyPlanCategory.departure,
      }),
      // Execute: CleaningServiceType.common_area,
      CleaningServiceType.common_area,
    );
  });

  // Begin block/object for the following statements.
  it("maps room departure plan to departure", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      deriveCleaningServiceType({
        // Carry this field through the payload or query.
        locationKind: LocationKind.room,
        // Carry this field through the payload or query.
        planCategory: DailyPlanCategory.departure,
      }),
      // Execute: CleaningServiceType.departure,
      CleaningServiceType.departure,
    );
  });

  // Begin block/object for the following statements.
  it("maps room arrival plan to arrival", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      deriveCleaningServiceType({
        // Carry this field through the payload or query.
        locationKind: LocationKind.room,
        // Carry this field through the payload or query.
        planCategory: DailyPlanCategory.arrival,
      }),
      // Execute: CleaningServiceType.arrival,
      CleaningServiceType.arrival,
    );
  });

  // Begin block/object for the following statements.
  it("defaults room without plan category to stayover", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: deriveCleaningServiceType({ locationKind: LocationKind.room }),
      deriveCleaningServiceType({ locationKind: LocationKind.room }),
      // Execute: CleaningServiceType.stayover,
      CleaningServiceType.stayover,
    );
  });

  // Begin block/object for the following statements.
  it("defaults room priority plan to stayover", () => {
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      deriveCleaningServiceType({
        // Carry this field through the payload or query.
        locationKind: LocationKind.room,
        // Carry this field through the payload or query.
        planCategory: DailyPlanCategory.priority,
      }),
      // Execute: CleaningServiceType.stayover,
      CleaningServiceType.stayover,
    );
  });
});

