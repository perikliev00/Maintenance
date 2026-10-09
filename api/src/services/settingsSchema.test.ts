import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isValidIanaTimeZone,
  operationsSchema,
} from "./settingsSchema";
import {
  hotelDateString,
  resolveUsableHotelTimeZone,
  zonedDayStartUtc,
} from "./attendance";

describe("hotelTimezone validation", () => {
  it("accepts Europe/Sofia and UTC", () => {
    assert.equal(isValidIanaTimeZone("Europe/Sofia"), true);
    assert.equal(isValidIanaTimeZone("UTC"), true);
    assert.equal(
      operationsSchema.safeParse({
        overdueSessionMinutes: 240,
        defaultTaskDueHours: 4,
        hotelTimezone: "Europe/Sofia",
      }).success,
      true,
    );
    assert.equal(
      operationsSchema.safeParse({
        overdueSessionMinutes: 240,
        defaultTaskDueHours: 4,
        hotelTimezone: "UTC",
      }).success,
      true,
    );
  });

  it("rejects Europe/Sofai without accepting the value", () => {
    assert.equal(isValidIanaTimeZone("Europe/Sofai"), false);
    const parsed = operationsSchema.safeParse({
      overdueSessionMinutes: 240,
      defaultTaskDueHours: 4,
      hotelTimezone: "Europe/Sofai",
    });
    assert.equal(parsed.success, false);
  });

  it("falls back safely for a previously stored invalid timezone", () => {
    const resolved = resolveUsableHotelTimeZone("Europe/Sofai");
    assert.equal(resolved.usedFallback, true);
    assert.equal(resolved.timeZone, "UTC");
    assert.doesNotThrow(() =>
      hotelDateString(new Date("2026-10-09T21:30:00.000Z"), "Europe/Sofai"),
    );
  });

  it("keeps hotel-day boundary correct for Europe/Sofia", () => {
    // 21:30 UTC on Oct 9 is already Oct 10 in Sofia (UTC+3).
    const ymd = hotelDateString(
      new Date("2026-10-09T21:30:00.000Z"),
      "Europe/Sofia",
    );
    assert.equal(ymd, "2026-10-10");
    const start = zonedDayStartUtc("2026-10-10", "Europe/Sofia");
    assert.equal(start.toISOString(), "2026-10-09T21:00:00.000Z");
  });
});
