// Import node:assert/strict for cleaning/deriveServiceType.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/deriveServiceType.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  CleaningServiceType,
  DailyPlanCategory,
  LocationKind,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ./deriveServiceType for cleaning/deriveServiceType.test.ts.
import { deriveCleaningServiceType } from "./deriveServiceType";

describe("deriveCleaningServiceType", () => {
  it("returns explicit serviceType when provided", () => {
    // Execute: assert.equal(
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        serviceType: CleaningServiceType.departure,
        planCategory: DailyPlanCategory.arrival,
      }),
      // Execute: CleaningServiceType.departure,
      CleaningServiceType.departure,
    );
  });

  it("returns common_area for non-room locations", () => {
    // Execute: assert.equal(
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.common_area,
        planCategory: DailyPlanCategory.departure,
      }),
      // Execute: CleaningServiceType.common_area,
      CleaningServiceType.common_area,
    );
  });

  it("maps room departure plan to departure", () => {
    // Execute: assert.equal(
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        planCategory: DailyPlanCategory.departure,
      }),
      // Execute: CleaningServiceType.departure,
      CleaningServiceType.departure,
    );
  });

  it("maps room arrival plan to arrival", () => {
    // Execute: assert.equal(
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        planCategory: DailyPlanCategory.arrival,
      }),
      // Execute: CleaningServiceType.arrival,
      CleaningServiceType.arrival,
    );
  });

  it("defaults room without plan category to stayover", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: deriveCleaningServiceType({ locationKind: LocationKind.room }),
      deriveCleaningServiceType({ locationKind: LocationKind.room }),
      // Execute: CleaningServiceType.stayover,
      CleaningServiceType.stayover,
    );
  });

  it("defaults room priority plan to stayover", () => {
    // Execute: assert.equal(
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        planCategory: DailyPlanCategory.priority,
      }),
      // Execute: CleaningServiceType.stayover,
      CleaningServiceType.stayover,
    );
  });
});

