/**
 * Smoke checks for atomic deferred departure room effects.
 * Requires DB + seeded owner/rooms. Does not need the HTTP API.
 */
import {
  CleaningStatus,
  DailyPlanCategory,
  DailyPlanSource,
  Occupancy,
  PrismaClient,
} from "@prisma/client";
import { hotelDateAsUtcDate } from "../src/services/attendance";
import { ensureDepartureRoomEffects } from "../src/services/dailyPlan";
import { getOperations } from "../src/services/settings";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@meridian.local" },
  });
  assert(owner.employeeId, "owner has no employeeId");

  const room = await prisma.location.findFirst({
    where: { catalogStatus: "active", kind: "room" },
    orderBy: { number: "asc" },
  });
  assert(room, "no active room");

  const ops = await getOperations();
  const hotelDate = hotelDateAsUtcDate(new Date(), ops.hotelTimezone);
  const cycleBefore = 40;

  // --- Concurrent apply: occupied + dirty (checkout morning) → vacant + cycle++ ---
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: cycleBefore,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });

  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.departure,
    },
  });

  const entry = await prisma.dailyPlanEntry.create({
    data: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.departure,
      source: DailyPlanSource.manual,
      notes: "smoke deferred departure effects",
      roomEffectsAppliedAt: null,
      createdByEmployeeId: owner.employeeId,
    },
  });
  console.log("entry", entry.id, "cycle_before", cycleBefore);

  const settled = await Promise.allSettled([
    ensureDepartureRoomEffects(hotelDate),
    ensureDepartureRoomEffects(hotelDate),
  ]);

  const oks = settled.filter((s) => s.status === "fulfilled");
  const fails = settled.filter((s) => s.status === "rejected");
  console.log(
    "concurrent_ensure",
    {
      ok: oks.length,
      fail: fails.length,
      errors: fails.map((f) =>
        f.status === "rejected" ? String(f.reason) : "",
      ),
      results: oks.map((s) =>
        s.status === "fulfilled" ? s.value : null,
      ),
    },
  );
  assert(oks.length === 2, `expected both ensure calls to settle ok, got ${oks.length}`);
  assert(fails.length === 0, `expected no failures, got ${fails.length}`);

  const appliedSum = oks.reduce(
    (n, s) => n + (s.status === "fulfilled" ? s.value.applied : 0),
    0,
  );
  assert(appliedSum === 1, `expected exactly one apply, got ${appliedSum}`);

  const afterEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: entry.id },
  });
  assert(
    afterEntry.roomEffectsAppliedAt != null,
    "roomEffectsAppliedAt should be set",
  );

  const afterRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    afterRoom.cleaningCycle === cycleBefore + 1,
    `expected cleaningCycle ${cycleBefore + 1}, got ${afterRoom.cleaningCycle}`,
  );
  assert(
    afterRoom.cleaningStatus === CleaningStatus.dirty,
    `expected dirty, got ${afterRoom.cleaningStatus}`,
  );
  assert(
    afterRoom.occupancy === Occupancy.vacant,
    `expected vacant, got ${afterRoom.occupancy}`,
  );

  // --- Skip: occupied + verified_clean (newer stay) → no room mutation ---
  const cycleSkipBefore = 55;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: cycleSkipBefore,
      cleaningStatus: CleaningStatus.verified_clean,
      occupancy: Occupancy.occupied,
    },
  });

  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.departure,
    },
  });

  const skipEntry = await prisma.dailyPlanEntry.create({
    data: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.departure,
      source: DailyPlanSource.manual,
      notes: "smoke skip occupied+clean",
      roomEffectsAppliedAt: null,
      createdByEmployeeId: owner.employeeId,
    },
  });

  const skipResult = await ensureDepartureRoomEffects(hotelDate);
  assert(skipResult.skipped === 1, `expected skipped=1, got ${skipResult.skipped}`);
  assert(skipResult.applied === 0, `expected applied=0, got ${skipResult.applied}`);

  const skipEntryAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: skipEntry.id },
  });
  assert(
    skipEntryAfter.roomEffectsAppliedAt != null,
    "roomEffectsAppliedAt should be set on skip",
  );

  const skipRoomAfter = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    skipRoomAfter.cleaningCycle === cycleSkipBefore,
    `expected cleaningCycle unchanged ${cycleSkipBefore}, got ${skipRoomAfter.cleaningCycle}`,
  );
  assert(
    skipRoomAfter.cleaningStatus === CleaningStatus.verified_clean,
    `expected verified_clean, got ${skipRoomAfter.cleaningStatus}`,
  );
  assert(
    skipRoomAfter.occupancy === Occupancy.occupied,
    `expected occupied, got ${skipRoomAfter.occupancy}`,
  );

  console.log("smoke-daily-plan-atomic: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
