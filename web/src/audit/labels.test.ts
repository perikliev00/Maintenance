/**
 * Unit coverage for audit labels / details .
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  AUDIT_ACTION_FILTERS,
  // Support the surrounding logic for this step.
  AUDIT_ENTITY_FILTERS,
  // Support the surrounding logic for this step.
  REQUIRED_AUDIT_PRODUCER_ACTIONS,
  // Support the surrounding logic for this step.
  auditHeadline,
  // Support the surrounding logic for this step.
  formatAuditDetails,
  // Support the surrounding logic for this step.
  formatJobSummary,
  // Support the surrounding logic for this step.
  jobKeyLabel,
// Support the surrounding logic for this step.
} from "./labels";

// Group related tests under a shared suite name.
describe("nested audit details", () => {
  // Define a single test case and its expectation.
  it("renders nested notification setting objects instead of [object Object]", () => {
    // Bind lines for use in the following logic.
    const lines = formatAuditDetails(
      // Support the surrounding logic for this step.
      { email: { enabled: true, status: "active" } },
      // Support the surrounding logic for this step.
      { email: { enabled: false, status: "disabled" } },
      // Support the surrounding logic for this step.
      "en",
    );
    // Bind joined for use in the following logic.
    const joined = lines.join("\n");
    // Invoke assert.equal to perform this step.
    assert.equal(joined.includes("[object Object]"), false);
    // Invoke assert.match to perform this step.
    assert.match(joined, /enabled/i);
    // Invoke assert.match to perform this step.
    assert.match(joined, /yes → no|true → false|да → не/i);
    // Invoke assert.match to perform this step.
    assert.match(joined, /active/i);
    // Invoke assert.match to perform this step.
    assert.match(joined, /disabled/i);
  });

  // Define a single test case and its expectation.
  it("formats arrays, null, and removed nested keys", () => {
    // Bind lines for use in the following logic.
    const lines = formatAuditDetails(
      // Support the surrounding logic for this step.
      { tags: ["a", "b"], note: { text: "old" } },
      // Support the surrounding logic for this step.
      { tags: ["a"], note: null },
      // Support the surrounding logic for this step.
      "en",
    );
    // Bind joined for use in the following logic.
    const joined = lines.join("\n");
    // Invoke assert.equal to perform this step.
    assert.equal(joined.includes("[object Object]"), false);
    // Invoke assert.match to perform this step.
    assert.match(joined, /Tags:/);
    // Invoke assert.match to perform this step.
    assert.match(joined, /removed|премахнато|null|—/);
  });
});

// Group related tests under a shared suite name.
describe("producer⊆filters coverage", () => {
  // Initialize an array used by subsequent logic.
  const requiredEntities = [
    // Support the surrounding logic for this step.
    "device",
    // Support the surrounding logic for this step.
    "employee",
    // Support the surrounding logic for this step.
    "invitation",
    // Support the surrounding logic for this step.
    "daily_plan_import_batch",
    // Support the surrounding logic for this step.
    "maintenance_ticket",
  ];

  // Define a single test case and its expectation.
  it("includes every known live producer action in filters", () => {
    // Map source items into a derived list for rendering or logic.
    const values = new Set(AUDIT_ACTION_FILTERS.map((f) => f.value));
    // Iterate a collection or counted range.
    for (const action of REQUIRED_AUDIT_PRODUCER_ACTIONS) {
      // Invoke assert.ok to perform this step.
      assert.ok(values.has(action), `missing action filter: ${action}`);
    }
  });

  // Define a single test case and its expectation.
  it("includes all required entity filters", () => {
    // Map source items into a derived list for rendering or logic.
    const values = new Set(AUDIT_ENTITY_FILTERS.map((f) => f.value));
    // Iterate a collection or counted range.
    for (const entity of requiredEntities) {
      // Invoke assert.ok to perform this step.
      assert.ok(values.has(entity), `missing entity filter: ${entity}`);
    }
  });
});

// Group related tests under a shared suite name.
describe("stale_open_attendance labels", () => {
  // Define a single test case and its expectation.
  it("uses a Bulgarian job name", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke jobKeyLabel to perform this step.
      jobKeyLabel("stale_open_attendance", "bg"),
      // Support the surrounding logic for this step.
      "Просрочени отворени присъствия",
    );
    // Invoke assert.notEqual to perform this step.
    assert.notEqual(
      // Invoke jobKeyLabel to perform this step.
      jobKeyLabel("stale_open_attendance", "bg"),
      // Support the surrounding logic for this step.
      "Stale open attendance",
    );
  });

  // Define a single test case and its expectation.
  it("formats scanned/flagged summary", () => {
    // Bind summary for use in the following logic.
    const summary = formatJobSummary(
      // Support the surrounding logic for this step.
      "stale_open_attendance",
      // Support the surrounding logic for this step.
      { scanned: 3, flagged: 1 },
      // Support the surrounding logic for this step.
      null,
      // Support the surrounding logic for this step.
      "bg",
    );
    // Invoke assert.match to perform this step.
    assert.match(summary, /проверени 3/);
    // Invoke assert.match to perform this step.
    assert.match(summary, /маркирани 1/);
  });
});

// Group related tests under a shared suite name.
describe("SLA headline prefers summary", () => {
  // Define a single test case and its expectation.
  it("shows room and title from summary", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke auditHeadline to perform this step.
      auditHeadline(
        {
          // Provide action field used by this structure.
          action: "ticket.sla_breach",
          // Provide entityType field used by this structure.
          entityType: "maintenance_ticket",
          // Provide summary field used by this structure.
          summary: "SLA: 101 — AC broken",
        },
        // Support the surrounding logic for this step.
        "en",
      ),
      // Support the surrounding logic for this step.
      "SLA: 101 — AC broken",
    );
  });
});
