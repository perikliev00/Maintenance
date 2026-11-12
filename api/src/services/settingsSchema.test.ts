// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module dependency for this service.
import {
  // Run next step: isValidIanaTimeZone,
  isValidIanaTimeZone,
  // Run next step: operationsSchema,
  operationsSchema,
// Run next step: } from "./settings/schema";
} from "./settings/schema";
// Import module dependency for this service.
import {
  // Run next step: hotelDateString,
  hotelDateString,
  // Run next step: resolveUsableHotelTimeZone,
  resolveUsableHotelTimeZone,
  // Run next step: zonedDayStartUtc,
  zonedDayStartUtc,
// Run next step: } from "./hotelTime";
} from "./hotelTime";

// Run next step: describe("hotelTimezone validation", () => {
describe("hotelTimezone validation", () => {
  // Run next step: it("accepts Europe/Sofia and UTC", () => {
  it("accepts Europe/Sofia and UTC", () => {
    // Run next step: assert.equal(isValidIanaTimeZone("Europe/Sofia"), true);
    assert.equal(isValidIanaTimeZone("Europe/Sofia"), true);
    // Run next step: assert.equal(isValidIanaTimeZone("UTC"), true);
    assert.equal(isValidIanaTimeZone("UTC"), true);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: operationsSchema.safeParse({
      operationsSchema.safeParse({
        // Set overdueSessionMinutes on the structure being built.
        overdueSessionMinutes: 240,
        // Set defaultTaskDueHours on the structure being built.
        defaultTaskDueHours: 4,
        // Set hotelTimezone on the structure being built.
        hotelTimezone: "Europe/Sofia",
      // Run next step: }).success,
      }).success,
      // Run next step: true,
      true,
    );
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: operationsSchema.safeParse({
      operationsSchema.safeParse({
        // Set overdueSessionMinutes on the structure being built.
        overdueSessionMinutes: 240,
        // Set defaultTaskDueHours on the structure being built.
        defaultTaskDueHours: 4,
        // Set hotelTimezone on the structure being built.
        hotelTimezone: "UTC",
      // Run next step: }).success,
      }).success,
      // Run next step: true,
      true,
    );
  });

  // Run next step: it("rejects Europe/Sofai without accepting the value", () =>…
  it("rejects Europe/Sofai without accepting the value", () => {
    // Run next step: assert.equal(isValidIanaTimeZone("Europe/Sofai"), false);
    assert.equal(isValidIanaTimeZone("Europe/Sofai"), false);
    // Capture parsed for use in this scope.
    const parsed = operationsSchema.safeParse({
      // Set overdueSessionMinutes on the structure being built.
      overdueSessionMinutes: 240,
      // Set defaultTaskDueHours on the structure being built.
      defaultTaskDueHours: 4,
      // Set hotelTimezone on the structure being built.
      hotelTimezone: "Europe/Sofai",
    });
    // Run next step: assert.equal(parsed.success, false);
    assert.equal(parsed.success, false);
  });

  // Run next step: it("falls back safely for a previously stored invalid timezo…
  it("falls back safely for a previously stored invalid timezone", () => {
    // Capture resolved for use in this scope.
    const resolved = resolveUsableHotelTimeZone("Europe/Sofai");
    // Run next step: assert.equal(resolved.usedFallback, true);
    assert.equal(resolved.usedFallback, true);
    // Run next step: assert.equal(resolved.timeZone, "UTC");
    assert.equal(resolved.timeZone, "UTC");
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: hotelDateString(new Date("2026-10-09T21:30:00.000Z"), "Europ…
      hotelDateString(new Date("2026-10-09T21:30:00.000Z"), "Europe/Sofai"),
    );
  });

  // Run next step: it("keeps hotel-day boundary correct for Europe/Sofia", () =…
  it("keeps hotel-day boundary correct for Europe/Sofia", () => {
    // 21:30 UTC on Oct 9 is already Oct 10 in Sofia (UTC+3).
    const ymd = hotelDateString(
      // Run next step: new Date("2026-10-09T21:30:00.000Z"),
      new Date("2026-10-09T21:30:00.000Z"),
      // Run next step: "Europe/Sofia",
      "Europe/Sofia",
    );
    // Run next step: assert.equal(ymd, "2026-10-10");
    assert.equal(ymd, "2026-10-10");
    // Capture start for use in this scope.
    const start = zonedDayStartUtc("2026-10-10", "Europe/Sofia");
    // Run next step: assert.equal(start.toISOString(), "2026-10-09T21:00:00.000Z"…
    assert.equal(start.toISOString(), "2026-10-09T21:00:00.000Z");
  });
});
