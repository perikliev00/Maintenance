// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./ticketLabels.
import { priorityLabel, statusLabel } from "./ticketLabels";

// Initialize an array used by subsequent logic.
const STATUSES = [
  // Support the surrounding logic for this step.
  "new",
  // Support the surrounding logic for this step.
  "assigned",
  // Support the surrounding logic for this step.
  "in_progress",
  // Support the surrounding logic for this step.
  "waiting",
  // Support the surrounding logic for this step.
  "resolved",
  // Support the surrounding logic for this step.
  "closed",
// Support the surrounding logic for this step.
] as const;

// Initialize an array used by subsequent logic.
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

// Group related tests under a shared suite name.
describe("ticketLabels", () => {
  // Define a single test case and its expectation.
  it("maps every known status for bg and en", () => {
    // Initialize an object holding related fields.
    const expectedBg: Record<(typeof STATUSES)[number], string> = {
      // Provide new field used by this structure.
      new: "Нов",
      // Provide assigned field used by this structure.
      assigned: "Назначен",
      // Provide in_progress field used by this structure.
      in_progress: "В работа",
      // Provide waiting field used by this structure.
      waiting: "Изчакване",
      // Provide resolved field used by this structure.
      resolved: "Решен",
      // Provide closed field used by this structure.
      closed: "Затворен",
    };
    // Initialize an object holding related fields.
    const expectedEn: Record<(typeof STATUSES)[number], string> = {
      // Provide new field used by this structure.
      new: "New",
      // Provide assigned field used by this structure.
      assigned: "Assigned",
      // Provide in_progress field used by this structure.
      in_progress: "In progress",
      // Provide waiting field used by this structure.
      waiting: "Waiting",
      // Provide resolved field used by this structure.
      resolved: "Resolved",
      // Provide closed field used by this structure.
      closed: "Closed",
    };
    // Iterate a collection or counted range.
    for (const status of STATUSES) {
      // Invoke assert.equal to perform this step.
      assert.equal(statusLabel("bg", status), expectedBg[status]);
      // Invoke assert.equal to perform this step.
      assert.equal(statusLabel("en", status), expectedEn[status]);
    }
  });

  // Define a single test case and its expectation.
  it("maps every known priority for bg and en", () => {
    // Initialize an object holding related fields.
    const expectedBg: Record<(typeof PRIORITIES)[number], string> = {
      // Provide low field used by this structure.
      low: "Нисък",
      // Provide normal field used by this structure.
      normal: "Нормален",
      // Provide high field used by this structure.
      high: "Висок",
      // Provide urgent field used by this structure.
      urgent: "Спешен",
    };
    // Initialize an object holding related fields.
    const expectedEn: Record<(typeof PRIORITIES)[number], string> = {
      // Provide low field used by this structure.
      low: "Low",
      // Provide normal field used by this structure.
      normal: "Normal",
      // Provide high field used by this structure.
      high: "High",
      // Provide urgent field used by this structure.
      urgent: "Urgent",
    };
    // Iterate a collection or counted range.
    for (const priority of PRIORITIES) {
      // Invoke assert.equal to perform this step.
      assert.equal(priorityLabel("bg", priority), expectedBg[priority]);
      // Invoke assert.equal to perform this step.
      assert.equal(priorityLabel("en", priority), expectedEn[priority]);
    }
  });

  // Define a single test case and its expectation.
  it("falls back to the raw value for unknown enums", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(statusLabel("bg", "unknown_status"), "unknown_status");
    // Invoke assert.equal to perform this step.
    assert.equal(priorityLabel("en", "unknown_priority"), "unknown_priority");
  });
});
