// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  isArchivedLocation,
  // Support the surrounding logic for this step.
  priorityLabel,
  // Support the surrounding logic for this step.
  statusLabel,
  t,
// Support the surrounding logic for this step.
} from "./helpers";
// Import type-only dependency for typing without runtime cost.
import type { MaintenanceTicket } from "../../api/client";

// Group related tests under a shared suite name.
describe("Repairs helpers localization", () => {
  // Define a single test case and its expectation.
  it("picks BG by default and EN when locale is en", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(t("bg", "Повреди", "Repairs"), "Повреди");
    // Invoke assert.equal to perform this step.
    assert.equal(t("en", "Повреди", "Repairs"), "Repairs");
  });

  // Define a single test case and its expectation.
  it("translates status and priority without changing enum keys", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(statusLabel("bg", "in_progress"), "В работа");
    // Invoke assert.equal to perform this step.
    assert.equal(statusLabel("en", "in_progress"), "In progress");
    // Invoke assert.equal to perform this step.
    assert.equal(priorityLabel("bg", "urgent"), "Спешен");
    // Invoke assert.equal to perform this step.
    assert.equal(priorityLabel("en", "urgent"), "Urgent");
    // Invoke assert.equal to perform this step.
    assert.equal(statusLabel("bg", "unknown_status"), "unknown_status");
  });

  // Define a single test case and its expectation.
  it("detects archived locations from catalogStatus", () => {
    // Initialize an object holding related fields.
    const base = {
      // Provide location field used by this structure.
      location: {
        // Provide id field used by this structure.
        id: "1",
        // Provide number field used by this structure.
        number: "101",
        // Provide floor field used by this structure.
        floor: { number: 1, building: { code: "A", name: "A" } },
      },
    // Support the surrounding logic for this step.
    } as MaintenanceTicket;
    // Invoke assert.equal to perform this step.
    assert.equal(isArchivedLocation(base), false);
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke isArchivedLocation to perform this step.
      isArchivedLocation({
        // Spread prior fields/items so overrides can layer cleanly.
        ...base,
        // Provide location field used by this structure.
        location: { ...base.location, catalogStatus: "archived" },
      }),
      // Support the surrounding logic for this step.
      true,
    );
  });
});
