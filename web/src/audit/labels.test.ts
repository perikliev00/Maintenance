/**
 * Unit coverage for audit labels / details .
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_ACTION_FILTERS,
  AUDIT_ENTITY_FILTERS,
  REQUIRED_AUDIT_PRODUCER_ACTIONS,
  auditHeadline,
  formatAuditDetails,
  formatJobSummary,
  jobKeyLabel,
} from "./labels";

describe("nested audit details", () => {
  it("renders nested notification setting objects instead of [object Object]", () => {
    const lines = formatAuditDetails(
      { email: { enabled: true, status: "active" } },
      { email: { enabled: false, status: "disabled" } },
      "en",
    );
    const joined = lines.join("\n");
    assert.equal(joined.includes("[object Object]"), false);
    assert.match(joined, /enabled/i);
    assert.match(joined, /yes → no|true → false|да → не/i);
    assert.match(joined, /active/i);
    assert.match(joined, /disabled/i);
  });

  it("formats arrays, null, and removed nested keys", () => {
    const lines = formatAuditDetails(
      { tags: ["a", "b"], note: { text: "old" } },
      { tags: ["a"], note: null },
      "en",
    );
    const joined = lines.join("\n");
    assert.equal(joined.includes("[object Object]"), false);
    assert.match(joined, /Tags:/);
    assert.match(joined, /removed|премахнато|null|—/);
  });
});

describe("producer⊆filters coverage", () => {
  const requiredEntities = [
    "device",
    "employee",
    "invitation",
    "daily_plan_import_batch",
    "maintenance_ticket",
  ];

  it("includes every known live producer action in filters", () => {
    const values = new Set(AUDIT_ACTION_FILTERS.map((f) => f.value));
    for (const action of REQUIRED_AUDIT_PRODUCER_ACTIONS) {
      assert.ok(values.has(action), `missing action filter: ${action}`);
    }
  });

  it("includes all required entity filters", () => {
    const values = new Set(AUDIT_ENTITY_FILTERS.map((f) => f.value));
    for (const entity of requiredEntities) {
      assert.ok(values.has(entity), `missing entity filter: ${entity}`);
    }
  });
});

describe("stale_open_attendance labels", () => {
  it("uses a Bulgarian job name", () => {
    assert.equal(
      jobKeyLabel("stale_open_attendance", "bg"),
      "Просрочени отворени присъствия",
    );
    assert.notEqual(
      jobKeyLabel("stale_open_attendance", "bg"),
      "Stale open attendance",
    );
  });

  it("formats scanned/flagged summary", () => {
    const summary = formatJobSummary(
      "stale_open_attendance",
      { scanned: 3, flagged: 1 },
      null,
      "bg",
    );
    assert.match(summary, /проверени 3/);
    assert.match(summary, /маркирани 1/);
  });
});

describe("SLA headline prefers summary", () => {
  it("shows room and title from summary", () => {
    assert.equal(
      auditHeadline(
        {
          action: "ticket.sla_breach",
          entityType: "maintenance_ticket",
          summary: "SLA: 101 — AC broken",
        },
        "en",
      ),
      "SLA: 101 — AC broken",
    );
  });
});
