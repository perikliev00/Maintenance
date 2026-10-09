/**
 * Smoke checks for atomic deferred departure room effects and historical
 * import/create guards. Requires DB + seeded owner/rooms. Does not need HTTP API.
 */
import {
  CleaningStatus,
  DailyPlanCategory,
  DailyPlanSource,
  Occupancy,
  Priority,
  PrismaClient,
  TaskStatus,
} from "@prisma/client";
import {
  hotelDateAsUtcDate,
  todayHotelDateYmd,
} from "../src/services/attendance";
import {
  createDailyPlanEntry,
  ensureDepartureRoomEffects,
  importDailyPlan,
} from "../src/services/dailyPlan";
import { getOperations } from "../src/services/settings";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@meridian.local" },
  });
  assert(owner.employeeId, "owner has no employeeId");
  const employeeId = owner.employeeId;

  const room = await prisma.location.findFirst({
    where: { catalogStatus: "active", kind: "room" },
    include: { floor: { include: { building: true } } },
    orderBy: { number: "asc" },
  });
  assert(room, "no active room");
  const buildingCode = room.floor.building.code;
  const roomNumber = room.number;

  const ops = await getOperations();
  const todayYmd = await todayHotelDateYmd();
  const hotelDate = hotelDateAsUtcDate(new Date(), ops.hotelTimezone);
  assert(
    hotelDate.toISOString().slice(0, 10) === todayYmd,
    `hotelDate key should match todayYmd ${todayYmd}`,
  );
  const pastYmd = addDaysYmd(todayYmd, -2);
  const futureYmd = addDaysYmd(todayYmd, 2);
  const pastHotelDate = new Date(`${pastYmd}T00:00:00.000Z`);
  const futureHotelDate = new Date(`${futureYmd}T00:00:00.000Z`);
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

  // Clear same-day arrivals/departures so newer-stay evidence does not leak
  // across smoke scenarios (or prior runs).
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
      locationId: room.id,
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
      createdByEmployeeId: employeeId,
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

  // --- Protect: occupied + arrival on/after plan day → no room mutation ---
  const cycleProtectBefore = 55;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: cycleProtectBefore,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });

  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
      locationId: room.id,
    },
  });

  await prisma.dailyPlanEntry.create({
    data: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.arrival,
      source: DailyPlanSource.manual,
      notes: "smoke newer stay arrival",
      createdByEmployeeId: employeeId,
    },
  });

  const protectEntry = await prisma.dailyPlanEntry.create({
    data: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.departure,
      source: DailyPlanSource.manual,
      notes: "smoke protect occupied+arrival",
      roomEffectsAppliedAt: null,
      createdByEmployeeId: employeeId,
    },
  });

  const protectResult = await ensureDepartureRoomEffects(hotelDate);
  assert(
    protectResult.skipped === 1,
    `expected skipped=1, got ${protectResult.skipped}`,
  );
  assert(
    protectResult.applied === 0,
    `expected applied=0, got ${protectResult.applied}`,
  );

  const protectEntryAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: protectEntry.id },
  });
  assert(
    protectEntryAfter.roomEffectsAppliedAt != null,
    "roomEffectsAppliedAt should be set on protect",
  );

  const protectRoomAfter = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    protectRoomAfter.cleaningCycle === cycleProtectBefore,
    `expected cleaningCycle unchanged ${cycleProtectBefore}, got ${protectRoomAfter.cleaningCycle}`,
  );
  assert(
    protectRoomAfter.occupancy === Occupancy.occupied,
    `expected occupied, got ${protectRoomAfter.occupancy}`,
  );

  // --- Historical import with current guest (occupied + dirty): defer, no state/task change ---
  const histCycle = 70;
  // Remove arrivals on/after the past day so this scenario stays "no newer-stay proof".
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      locationId: room.id,
      OR: [
        { hotelDate: pastHotelDate },
        {
          category: DailyPlanCategory.arrival,
          hotelDate: { gte: pastHotelDate },
        },
      ],
    },
  });
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: histCycle,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });
  // Marker for "current" work — must stay untouched by historical plan writes.
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      hotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework] },
    },
    data: { status: TaskStatus.cancelled },
  });
  const currentTask = await prisma.cleaningTask.create({
    data: {
      locationId: room.id,
      hotelDate,
      priority: Priority.normal,
      status: TaskStatus.assigned,
      cleaningCycle: histCycle,
    },
  });

  const histExternalId = `smoke-hist-dep-${room.id}-${pastYmd}`;
  const importResult = await importDailyPlan(
    {
      hotelDate: pastYmd,
      sourceLabel: "smoke-historical",
      entries: [
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.departure,
          externalId: histExternalId,
          notes: "historical import current guest",
        },
      ],
    },
    employeeId,
  );
  assert(
    importResult.batch.createdCount === 1,
    `expected createdCount=1, got ${importResult.batch.createdCount}`,
  );

  const histRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(histRoom.occupancy === Occupancy.occupied, "hist import kept occupied");
  assert(
    histRoom.cleaningStatus === CleaningStatus.dirty,
    "hist import kept dirty",
  );
  assert(
    histRoom.cleaningCycle === histCycle,
    `hist import kept cycle ${histCycle}, got ${histRoom.cleaningCycle}`,
  );

  const histTask = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: currentTask.id },
  });
  assert(
    histTask.cleaningCycle === histCycle,
    "hist import must not rebind current task cycle",
  );
  assert(
    histTask.priority === Priority.normal,
    "hist import must not bump current task priority",
  );
  assert(
    histTask.status === TaskStatus.assigned,
    "hist import must not change current task status",
  );

  const histEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: {
      hotelDate_locationId_category: {
        hotelDate: pastHotelDate,
        locationId: room.id,
        category: DailyPlanCategory.departure,
      },
    },
  });
  assert(
    histEntry.roomEffectsAppliedAt == null,
    "hist import defer leaves roomEffectsAppliedAt null",
  );
  assert(
    histEntry.cleaningTaskId == null,
    "hist import should not bind a departure task when deferring",
  );

  // --- Re-import same historical payload: idempotent, state still unchanged ---
  const reimport = await importDailyPlan(
    {
      hotelDate: pastYmd,
      sourceLabel: "smoke-historical-reimport",
      entries: [
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.departure,
          externalId: histExternalId,
          notes: "reimport",
        },
      ],
    },
    employeeId,
  );
  assert(
    reimport.batch.createdCount === 0,
    `expected reimport createdCount=0, got ${reimport.batch.createdCount}`,
  );
  assert(
    reimport.batch.skippedCount === 1,
    `expected reimport skippedCount=1, got ${reimport.batch.skippedCount}`,
  );
  const reimportRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(reimportRoom.occupancy === Occupancy.occupied, "reimport kept occupied");
  assert(
    reimportRoom.cleaningCycle === histCycle,
    "reimport kept cleaningCycle",
  );

  // --- Historical manual create with current guest ---
  const manualPastYmd = addDaysYmd(todayYmd, -3);
  const manualPastHotelDate = new Date(`${manualPastYmd}T00:00:00.000Z`);
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      locationId: room.id,
      hotelDate: manualPastHotelDate,
      category: DailyPlanCategory.departure,
    },
  });
  const manualCycle = histCycle;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: manualCycle,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });

  const manualResult = await createDailyPlanEntry({
    hotelDate: manualPastYmd,
    locationId: room.id,
    category: DailyPlanCategory.departure,
    notes: "historical manual current guest",
    createdByEmployeeId: employeeId,
  });
  assert(
    manualResult.effects.occupancy == null,
    "manual hist should not report vacant effect",
  );
  assert(
    manualResult.effects.task === "skipped",
    `manual hist task effect skipped, got ${manualResult.effects.task}`,
  );

  const manualRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(manualRoom.occupancy === Occupancy.occupied, "manual hist kept occupied");
  assert(
    manualRoom.cleaningCycle === manualCycle,
    "manual hist kept cleaningCycle",
  );
  assert(
    manualRoom.cleaningStatus === CleaningStatus.dirty,
    "manual hist kept dirty",
  );
  const manualTask = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: currentTask.id },
  });
  assert(
    manualTask.cleaningCycle === manualCycle,
    "manual hist must not rebind current task",
  );

  const manualEntryRow = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: manualResult.entry.id },
  });
  assert(
    manualEntryRow.roomEffectsAppliedAt == null,
    "manual hist defer leaves roomEffectsAppliedAt null",
  );
  assert(
    manualEntryRow.cleaningTaskId == null,
    "manual hist should not create bound task",
  );

  // --- Valid current-day departure via create: vacant + dirty + cycle++ ---
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
      locationId: room.id,
    },
  });
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      hotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework] },
    },
    data: { status: TaskStatus.cancelled },
  });
  const todayCycle = 80;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: todayCycle,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });

  const todayResult = await createDailyPlanEntry({
    hotelDate: todayYmd,
    locationId: room.id,
    category: DailyPlanCategory.departure,
    notes: "valid today departure",
    createdByEmployeeId: employeeId,
  });
  assert(
    todayResult.effects.occupancy === "vacant",
    `expected vacant effect, got ${todayResult.effects.occupancy}`,
  );
  assert(todayResult.effects.dirty === true, "expected dirty effect");
  assert(
    todayResult.effects.task === "created",
    `expected task created, got ${todayResult.effects.task}`,
  );

  const todayRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(todayRoom.occupancy === Occupancy.vacant, "today departure → vacant");
  assert(
    todayRoom.cleaningStatus === CleaningStatus.dirty,
    "today departure → dirty",
  );
  // bumpDirtyAndRebindWork (+1) then createTask allocateCleaningCycle (+1)
  assert(
    todayRoom.cleaningCycle === todayCycle + 2,
    `expected cycle ${todayCycle + 2}, got ${todayRoom.cleaningCycle}`,
  );

  // --- Future departure: plan stored, room unchanged ---
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      locationId: room.id,
      hotelDate: futureHotelDate,
      category: DailyPlanCategory.departure,
    },
  });
  const futureCycle = 90;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: futureCycle,
      cleaningStatus: CleaningStatus.verified_clean,
      occupancy: Occupancy.occupied,
    },
  });

  const futureResult = await createDailyPlanEntry({
    hotelDate: futureYmd,
    locationId: room.id,
    category: DailyPlanCategory.departure,
    notes: "future departure",
    createdByEmployeeId: employeeId,
  });
  assert(
    futureResult.effects.occupancy == null,
    "future departure must not vacate",
  );
  assert(futureResult.effects.dirty === false, "future departure must not dirty");

  const futureRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    futureRoom.occupancy === Occupancy.occupied,
    "future departure kept occupied",
  );
  assert(
    futureRoom.cleaningCycle === futureCycle,
    "future departure kept cleaningCycle",
  );
  assert(
    futureRoom.cleaningStatus === CleaningStatus.verified_clean,
    "future departure kept verified_clean",
  );

  const futureEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: futureResult.entry.id },
  });
  assert(
    futureEntry.roomEffectsAppliedAt == null,
    "future departure leaves roomEffectsAppliedAt null",
  );

  // --- Historical import with proven newer stay (arrival) → protect ---
  const protectPastYmd = addDaysYmd(todayYmd, -4);
  const protectPastHotelDate = new Date(`${protectPastYmd}T00:00:00.000Z`);
  await prisma.dailyPlanEntry.deleteMany({
    where: { locationId: room.id, hotelDate: protectPastHotelDate },
  });
  const protectImportCycle = 95;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: protectImportCycle,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });
  await prisma.dailyPlanEntry.create({
    data: {
      hotelDate: protectPastHotelDate,
      locationId: room.id,
      category: DailyPlanCategory.arrival,
      source: DailyPlanSource.manual,
      notes: "arrival proving newer stay",
      createdByEmployeeId: employeeId,
    },
  });

  const protectImport = await importDailyPlan(
    {
      hotelDate: protectPastYmd,
      sourceLabel: "smoke-protect-import",
      entries: [
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.departure,
          externalId: `smoke-protect-${room.id}-${protectPastYmd}`,
        },
      ],
    },
    employeeId,
  );
  assert(
    protectImport.batch.createdCount === 1,
    `expected protect import created=1, got ${protectImport.batch.createdCount}`,
  );
  const protectImportRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    protectImportRoom.occupancy === Occupancy.occupied,
    "protect import kept occupied",
  );
  assert(
    protectImportRoom.cleaningCycle === protectImportCycle,
    "protect import kept cycle",
  );
  const protectImportEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: {
      hotelDate_locationId_category: {
        hotelDate: protectPastHotelDate,
        locationId: room.id,
        category: DailyPlanCategory.departure,
      },
    },
  });
  assert(
    protectImportEntry.roomEffectsAppliedAt != null,
    "protect import stamps roomEffectsAppliedAt",
  );
  assert(
    protectImportEntry.cleaningTaskId == null,
    "protect import should not create bound task",
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
