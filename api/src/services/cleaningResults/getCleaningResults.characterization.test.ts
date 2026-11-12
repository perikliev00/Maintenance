/**
 * Characterization: empty / filter / period contracts for getCleaningResults
 * before further BE-009 splits.
 *
 * Dense aggregation/sorting: assembleCleaningResults.characterization.test.ts
 * Joined real rows + HTTP parity: tests/scenarios/analytics.db.test.ts
 * Period helpers: periodBounds.test.ts
 *
 * Still thin here (intentionally): live getOperations anomaly threshold wiring,
 * concurrent mutation during report read, multi-tenant scope stress.
 */
import assert from "node:assert/strict";
// Import node:test for cleaningResults/getCleaningResults.characterization.test.ts.
import { after, before, describe, it } from "node:test";
// Import ../../db for cleaningResults/getCleaningResults.characterization.test.ts.
import { prisma } from "../../db";
// Import ../../../tests/assertTestDatabase for cleaningResults/getCleaningResults.characterization.test.ts.
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
// Import ./getCleaningResults for cleaningResults/getCleaningResults.characterization.test.ts.
import { getCleaningResults } from "./getCleaningResults";
// Import ./periodBounds for cleaningResults/getCleaningResults.characterization.test.ts.
import { dayEndExclusiveUtc, dayStartUtc } from "./periodBounds";

describe("getCleaningResults characterization", () => {
  before(async () => {
    await assertTestDatabase(prisma);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("empty period returns zeroed summary, empty rows, and hour series", async () => {
    // Load report needed for the next decision or write.
    const report = await getCleaningResults({
      from: "1990-01-01",
      to: "1990-01-01",
      page: 1,
      pageSize: 10,
      // Force no matches even if seed data exists in far future.
      taskWhere: { id: "__characterization_none__" },
      sessionWhere: { taskId: "__characterization_none__" },
    });

    // Execute: assert.deepEqual(report.period, { from: "1990-01-01", to: "1990-01-01" });
    assert.deepEqual(report.period, { from: "1990-01-01", to: "1990-01-01" });
    // Execute: assert.equal(report.summary.completedTasks, 0);
    assert.equal(report.summary.completedTasks, 0);
    // Execute: assert.equal(report.summary.completedSessions, 0);
    assert.equal(report.summary.completedSessions, 0);
    // Execute: assert.equal(report.summary.housekeeperCount, 0);
    assert.equal(report.summary.housekeeperCount, 0);
    // Execute: assert.equal(report.summary.productivity, null);
    assert.equal(report.summary.productivity, null);
    // Execute: assert.equal(report.summary.onTimePct, null);
    assert.equal(report.summary.onTimePct, null);
    // Execute: assert.deepEqual(report.summary.byServiceType, []);
    assert.deepEqual(report.summary.byServiceType, []);
    // Execute: assert.equal(report.rows.length, 0);
    assert.equal(report.rows.length, 0);
    // Execute: assert.equal(report.total, 0);
    assert.equal(report.total, 0);
    // Execute: assert.equal(report.page, 1);
    assert.equal(report.page, 1);
    // Execute: assert.equal(report.pageSize, 10);
    assert.equal(report.pageSize, 10);
    // Execute: assert.equal(report.series.length, 24);
    assert.equal(report.series.length, 24);
    // Execute: assert.ok(report.series.every((s, hour) => s.hour === hour && s.completedSess...
    assert.ok(report.series.every((s, hour) => s.hour === hour && s.completedSessions === 0));
    // Execute: assert.ok(!JSON.stringify(report).includes("NaN"));
    assert.ok(!JSON.stringify(report).includes("NaN"));
    // Execute: assert.ok(!JSON.stringify(report).includes("Infinity"));
    assert.ok(!JSON.stringify(report).includes("Infinity"));
  });

  it("page beyond total yields empty rows while total stays 0 for empty scope", async () => {
    // Load report needed for the next decision or write.
    const report = await getCleaningResults({
      from: "1990-01-02",
      to: "1990-01-02",
      page: 5,
      pageSize: 20,
      taskWhere: { id: "__characterization_none__" },
      sessionWhere: { taskId: "__characterization_none__" },
    });
    // Execute: assert.equal(report.page, 5);
    assert.equal(report.page, 5);
    // Execute: assert.equal(report.pageSize, 20);
    assert.equal(report.pageSize, 20);
    // Execute: assert.equal(report.total, 0);
    assert.equal(report.total, 0);
    // Execute: assert.deepEqual(report.rows, []);
    assert.deepEqual(report.rows, []);
  });

  it("empty serviceTypes array does not change empty-scope contract", async () => {
    // Load base needed for the next decision or write.
    const base = await getCleaningResults({
      from: "1990-01-03",
      to: "1990-01-03",
      page: 1,
      pageSize: 10,
      taskWhere: { id: "__characterization_none__" },
      sessionWhere: { taskId: "__characterization_none__" },
    });
    // Load withEmptyTypes needed for the next decision or write.
    const withEmptyTypes = await getCleaningResults({
      from: "1990-01-03",
      to: "1990-01-03",
      page: 1,
      pageSize: 10,
      serviceTypes: [],
      taskWhere: { id: "__characterization_none__" },
      sessionWhere: { taskId: "__characterization_none__" },
    });
    // Execute: assert.deepEqual(withEmptyTypes.summary, base.summary);
    assert.deepEqual(withEmptyTypes.summary, base.summary);
    // Execute: assert.deepEqual(withEmptyTypes.series, base.series);
    assert.deepEqual(withEmptyTypes.series, base.series);
  });

  it("inclusive single-day bounds match periodBounds half-open window", async () => {
    const from = "2024-02-29";
    const to = "2024-02-29";
    // Execute: assert.equal(dayStartUtc(from).toISOString(), "2024-02-29T00:00:00.000Z");
    assert.equal(dayStartUtc(from).toISOString(), "2024-02-29T00:00:00.000Z");
    // Execute: assert.equal(dayEndExclusiveUtc(to).toISOString(), "2024-03-01T00:00:00.000Z");
    assert.equal(dayEndExclusiveUtc(to).toISOString(), "2024-03-01T00:00:00.000Z");
    // Load report needed for the next decision or write.
    const report = await getCleaningResults({
      from,
      to,
      page: 1,
      pageSize: 5,
      taskWhere: { id: "__characterization_none__" },
      sessionWhere: { taskId: "__characterization_none__" },
    });
    // Execute: assert.deepEqual(report.period, { from, to });
    assert.deepEqual(report.period, { from, to });
  });
});
