/**
 * Characterization: deleteDailyPlanEntry owns lookup + scope + delete.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  type CleaningWorld,
} from "../../../tests/cleaning/fixtures";
import { createDailyPlanEntry } from "./create";
import { deleteDailyPlanEntry } from "./delete";
import { todayHotelDateYmd } from "../hotelTime";
import type { DataScope } from "../dataScope";

function allScope(employeeId: string): DataScope {
  return {
    kind: "all",
    employeeId,
    role: Role.owner,
    sectorIds: [],
  };
}

function emptySectorsScope(employeeId: string): DataScope {
  return {
    kind: "sectors",
    employeeId,
    role: Role.supervisor,
    sectorIds: [],
  };
}

describe("deleteDailyPlanEntry scope", () => {
  let world: CleaningWorld;

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
  });

  after(async () => {
    if (world) {
      await prisma.dailyPlanEntry.deleteMany({
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("deletes when caller has all scope", async () => {
    const created = await createDailyPlanEntry({
      hotelDate: await todayHotelDateYmd(),
      locationId: world.locationAId,
      category: "arrival",
      createdByEmployeeId: world.owner.employeeId,
    });
    const result = await deleteDailyPlanEntry(
      created.entry.id,
      allScope(world.owner.employeeId),
    );
    assert.deepEqual(result, { id: created.entry.id, deleted: true });
    assert.equal(
      await prisma.dailyPlanEntry.findUnique({ where: { id: created.entry.id } }),
      null,
    );
  });

  it("returns not_found for missing id", async () => {
    await assert.rejects(
      () =>
        deleteDailyPlanEntry(
          "missing-plan-entry-id",
          allScope(world.owner.employeeId),
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 404 &&
        err.code === "not_found",
    );
  });

  it("rejects out-of-scope sector caller without deleting", async () => {
    const created = await createDailyPlanEntry({
      hotelDate: await todayHotelDateYmd(),
      locationId: world.locationBId,
      category: "priority",
      createdByEmployeeId: world.owner.employeeId,
    });
    await assert.rejects(
      () =>
        deleteDailyPlanEntry(
          created.entry.id,
          emptySectorsScope(world.manager.employeeId),
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 403 &&
        err.code === "forbidden",
    );
    assert.ok(
      await prisma.dailyPlanEntry.findUnique({ where: { id: created.entry.id } }),
    );
    await prisma.dailyPlanEntry.delete({ where: { id: created.entry.id } });
  });
});
