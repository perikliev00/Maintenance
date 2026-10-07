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

  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: cycleBefore,
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
    },
  );
  assert(oks.length === 2, `expected both ensure calls to settle ok, got ${oks.length}`);
  assert(fails.length === 0, `expected no failures, got ${fails.length}`);

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
