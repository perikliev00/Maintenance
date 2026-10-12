import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CleaningServiceType,
  DailyPlanCategory,
  LocationKind,
} from "@prisma/client";
import { deriveCleaningServiceType } from "./deriveServiceType";

describe("deriveCleaningServiceType", () => {
  it("returns explicit serviceType when provided", () => {
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        serviceType: CleaningServiceType.departure,
        planCategory: DailyPlanCategory.arrival,
      }),
      CleaningServiceType.departure,
    );
  });

  it("returns common_area for non-room locations", () => {
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.common_area,
        planCategory: DailyPlanCategory.departure,
      }),
      CleaningServiceType.common_area,
    );
  });

  it("maps room departure plan to departure", () => {
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        planCategory: DailyPlanCategory.departure,
      }),
      CleaningServiceType.departure,
    );
  });

  it("maps room arrival plan to arrival", () => {
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        planCategory: DailyPlanCategory.arrival,
      }),
      CleaningServiceType.arrival,
    );
  });

  it("defaults room without plan category to stayover", () => {
    assert.equal(
      deriveCleaningServiceType({ locationKind: LocationKind.room }),
      CleaningServiceType.stayover,
    );
  });

  it("defaults room priority plan to stayover", () => {
    assert.equal(
      deriveCleaningServiceType({
        locationKind: LocationKind.room,
        planCategory: DailyPlanCategory.priority,
      }),
      CleaningServiceType.stayover,
    );
  });
});

