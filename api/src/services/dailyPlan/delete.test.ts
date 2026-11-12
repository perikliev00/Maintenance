/**
 * Characterization: deleteDailyPlanEntry owns lookup + scope + delete.
 */
import assert from "node:assert/strict";
// Import node:test for dailyPlan/delete.test.ts.
import { after, before, describe, it } from "node:test";
// Import @prisma/client for dailyPlan/delete.test.ts.
import { Role } from "@prisma/client";
// Import ../../db for dailyPlan/delete.test.ts.
import { prisma } from "../../db";
// Import ../../errors for dailyPlan/delete.test.ts.
import { AppError } from "../../errors";
// Import ../../../tests/assertTestDatabase for dailyPlan/delete.test.ts.
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
// Side-effect or default import required by this module.
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  // Local structural type for this module's contracts.
  type CleaningWorld,
// Execute: } from "../../../tests/cleaning/fixtures";
} from "../../../tests/cleaning/fixtures";
// Import ./create for dailyPlan/delete.test.ts.
import { createDailyPlanEntry } from "./create";
// Import ./delete for dailyPlan/delete.test.ts.
import { deleteDailyPlanEntry } from "./delete";
// Import ../hotelTime for dailyPlan/delete.test.ts.
import { todayHotelDateYmd } from "../hotelTime";
import type { DataScope } from "../dataScope";

// Local helper allScope keeps the main flow readable.
function allScope(employeeId: string): DataScope {
  return {
    kind: "all",
    employeeId,
    role: Role.owner,
    sectorIds: [],
  };
}

// Local helper emptySectorsScope keeps the main flow readable.
function emptySectorsScope(employeeId: string): DataScope {
  return {
    kind: "sectors",
    employeeId,
    role: Role.supervisor,
    sectorIds: [],
  };
}

describe("deleteDailyPlanEntry scope", () => {
  // Execute: let world: CleaningWorld;
  let world: CleaningWorld;

  before(async () => {
    await assertTestDatabase(prisma);
    // Execute: world = await createCleaningWorld(prisma);
    world = await createCleaningWorld(prisma);
  });

  after(async () => {
    // Branch when this condition holds for the domain rule.
    if (world) {
      // Persist the mutation inside the current transaction/context.
      await prisma.dailyPlanEntry.deleteMany({
        // Restrict the query to the relevant rows only.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("deletes when caller has all scope", async () => {
    // Load created needed for the next decision or write.
    const created = await createDailyPlanEntry({
      hotelDate: await todayHotelDateYmd(),
      locationId: world.locationAId,
      category: "arrival",
      createdByEmployeeId: world.owner.employeeId,
    });
    // Load result needed for the next decision or write.
    const result = await deleteDailyPlanEntry(
      // Execute: created.entry.id,
      created.entry.id,
      // Execute: allScope(world.owner.employeeId),
      allScope(world.owner.employeeId),
    );
    // Execute: assert.deepEqual(result, { id: created.entry.id, deleted: true });
    assert.deepEqual(result, { id: created.entry.id, deleted: true });
    // Execute: assert.equal(
    assert.equal(
      // Read the latest row(s) needed for this step.
      await prisma.dailyPlanEntry.findUnique({ where: { id: created.entry.id } }),
      null,
    );
  });

  it("returns not_found for missing id", async () => {
    await assert.rejects(
      // Execute: () =>
      () =>
        // Execute: deleteDailyPlanEntry(
        deleteDailyPlanEntry(
          // Execute: "missing-plan-entry-id",
          "missing-plan-entry-id",
          // Execute: allScope(world.owner.employeeId),
          allScope(world.owner.employeeId),
        ),
      // Execute: (err: unknown) =>
      (err: unknown) =>
        // Surface a structured AppError for this failure mode.
        err instanceof AppError &&
        // Execute: err.status === 404 &&
        err.status === 404 &&
        // Execute: err.code === "not_found",
        err.code === "not_found",
    );
  });

  it("rejects out-of-scope sector caller without deleting", async () => {
    // Load created needed for the next decision or write.
    const created = await createDailyPlanEntry({
      hotelDate: await todayHotelDateYmd(),
      locationId: world.locationBId,
      category: "priority",
      createdByEmployeeId: world.owner.employeeId,
    });
    await assert.rejects(
      // Execute: () =>
      () =>
        // Execute: deleteDailyPlanEntry(
        deleteDailyPlanEntry(
          // Execute: created.entry.id,
          created.entry.id,
          // Execute: emptySectorsScope(world.manager.employeeId),
          emptySectorsScope(world.manager.employeeId),
        ),
      // Execute: (err: unknown) =>
      (err: unknown) =>
        // Surface a structured AppError for this failure mode.
        err instanceof AppError &&
        // Execute: err.status === 403 &&
        err.status === 403 &&
        // Execute: err.code === "forbidden",
        err.code === "forbidden",
    );
    // Execute: assert.ok(
    assert.ok(
      // Read the latest row(s) needed for this step.
      await prisma.dailyPlanEntry.findUnique({ where: { id: created.entry.id } }),
    );
    // Persist the mutation inside the current transaction/context.
    await prisma.dailyPlanEntry.delete({ where: { id: created.entry.id } });
  });
});
