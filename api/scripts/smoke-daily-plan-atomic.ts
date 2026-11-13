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
import { setLocationOccupancy } from "../src/services/locations";
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
  const roomRow = room;
  const buildingCode = roomRow.floor.building.code;
  const roomNumber = roomRow.number;

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

  // Concurrent apply of one same-day departure. Exactly one call claims the
  // entry (applied === 1). With no active task, that winner runs two cycle
  // allocations: bumpDirtyAndRebindWork → allocateCleaningCycle (+1), then
  // createTaskWithSectorSnapshot → resolveCycleForNewTask → allocateCleaningCycle (+1).
  // The loser sees roomEffectsAppliedAt and does not allocate. Net cycle is +2.
  // On 195dfbbb CI the old +1 assertion saw 42: earlier smokes had cleared the
  // seed task on the first room, so ensure created one. A leftover active task
  // links instead and only bump allocates (+1). Cancel active tasks here so
  // both environments take the create path. Cleaning-cycle rules are unchanged.
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      hotelDate,
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.awaiting_inspection,
          TaskStatus.rework,
        ],
      },
    },
    data: { status: TaskStatus.cancelled },
  });
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: cycleBefore,
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.occupied,
    },
  });

  // Clear ALL same-day departure entries. Seed creates several departures for
  // "today"; ensureDepartureRoomEffects applies every matching row, so a
  // room-scoped delete left applied≈N on a fresh CI working DB.
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
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
    afterRoom.cleaningCycle === cycleBefore + 2,
    `expected cleaningCycle ${cycleBefore + 2}, got ${afterRoom.cleaningCycle}`,
  );
  assert(
    afterRoom.cleaningStatus === CleaningStatus.dirty,
    `expected dirty, got ${afterRoom.cleaningStatus}`,
  );
  assert(
    afterRoom.occupancy === Occupancy.vacant,
    `expected vacant, got ${afterRoom.occupancy}`,
  );

  // --- Planned arrival alone must not protect same-day departure ---
  const cycleArrivalNoProtect = 55;
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      hotelDate,
      locationId: room.id,
    },
  });
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: cycleArrivalNoProtect,
      cleaningStatus: CleaningStatus.verified_clean,
      occupancy: Occupancy.occupied,
    },
  });
  await prisma.dailyPlanEntry.create({
    data: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.arrival,
      source: DailyPlanSource.manual,
      notes: "planned arrival is not newer-stay proof",
      createdByEmployeeId: employeeId,
    },
  });
  const arrivalNoProtectDep = await prisma.dailyPlanEntry.create({
    data: {
      hotelDate,
      locationId: room.id,
      category: DailyPlanCategory.departure,
      source: DailyPlanSource.manual,
      notes: "departure with planned arrival present",
      roomEffectsAppliedAt: null,
      createdByEmployeeId: employeeId,
    },
  });
  const arrivalNoProtectResult = await ensureDepartureRoomEffects(hotelDate);
  assert(
    arrivalNoProtectResult.applied === 1,
    `planned arrival must not protect; expected applied=1, got ${arrivalNoProtectResult.applied}`,
  );
  assert(
    arrivalNoProtectResult.skipped === 0,
    `expected skipped=0, got ${arrivalNoProtectResult.skipped}`,
  );
  const arrivalNoProtectRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    arrivalNoProtectRoom.occupancy === Occupancy.vacant,
    "planned arrival must not block vacate",
  );
  assert(
    arrivalNoProtectRoom.cleaningStatus === CleaningStatus.dirty,
    "planned arrival must not block dirty",
  );
  const arrivalNoProtectEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: arrivalNoProtectDep.id },
  });
  assert(
    arrivalNoProtectEntry.roomEffectsAppliedAt != null,
    "departure effects should be stamped when applied",
  );

  // --- Historical import with current guest (occupied + dirty): defer, no state/task change ---
  const histCycle = 70;
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      locationId: room.id,
      hotelDate: pastHotelDate,
    },
  });
  // Drop prior reoccupy audits so this run stays "no newer-stay proof".
  await prisma.auditEvent.deleteMany({
    where: {
      locationId: room.id,
      action: "location.set_occupancy",
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

  // --- Confirm deferred departure: vacant/dirty + linked/created cleaning task ---
  // Cancel today's currentTask so confirm does not collide with hotelDate tasks.
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      hotelDate: manualPastHotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework] },
    },
    data: { status: TaskStatus.cancelled },
  });
  const cycleBeforeConfirm = manualRoom.cleaningCycle;
  const confirmFirst = await ensureDepartureRoomEffects(manualPastHotelDate, undefined, {
    confirmEntryIds: [manualEntryRow.id],
  });
  assert(confirmFirst.applied === 1, `confirm applied=1, got ${confirmFirst.applied}`);
  assert(confirmFirst.deferred === 0, `confirm deferred=0, got ${confirmFirst.deferred}`);

  const confirmedRoom = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(confirmedRoom.occupancy === Occupancy.vacant, "confirm → vacant");
  assert(
    confirmedRoom.cleaningStatus === CleaningStatus.dirty,
    "confirm → dirty",
  );
  assert(
    confirmedRoom.cleaningCycle === cycleBeforeConfirm + 1 ||
      confirmedRoom.cleaningCycle === cycleBeforeConfirm + 2,
    `confirm bumps cycle, before=${cycleBeforeConfirm} after=${confirmedRoom.cleaningCycle}`,
  );

  const confirmedEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: manualEntryRow.id },
  });
  assert(
    confirmedEntry.roomEffectsAppliedAt != null,
    "confirm stamps roomEffectsAppliedAt",
  );
  assert(
    confirmedEntry.cleaningTaskId != null,
    "confirm links/creates cleaningTaskId",
  );
  const confirmTasks = await prisma.cleaningTask.findMany({
    where: {
      locationId: room.id,
      hotelDate: manualPastHotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework] },
    },
  });
  assert(
    confirmTasks.length === 1,
    `confirm should leave exactly 1 active task, got ${confirmTasks.length}`,
  );
  assert(
    confirmTasks[0].id === confirmedEntry.cleaningTaskId,
    "entry cleaningTaskId matches active task",
  );
  assert(
    confirmTasks[0].priority === Priority.high,
    "confirm task priority high",
  );

  // Re-confirm: no second apply / no duplicate task
  const confirmReplay = await ensureDepartureRoomEffects(manualPastHotelDate, undefined, {
    confirmEntryIds: [manualEntryRow.id],
  });
  assert(confirmReplay.applied === 0, "replay confirm applied=0");
  assert(confirmReplay.total === 0, "replay confirm total=0 (already stamped)");
  const confirmTasksAfterReplay = await prisma.cleaningTask.count({
    where: {
      locationId: room.id,
      hotelDate: manualPastHotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework] },
    },
  });
  assert(
    confirmTasksAfterReplay === 1,
    "replay confirm must not create duplicate task",
  );

  // Unconfirmed hist deferred entry remains deferred when room is still occupied
  // (vacant rooms apply without confirm — re-occupy so defer path is exercised).
  await prisma.location.update({
    where: { id: room.id },
    data: {
      occupancy: Occupancy.occupied,
      cleaningStatus: CleaningStatus.dirty,
    },
  });
  const histStillDeferred = await ensureDepartureRoomEffects(pastHotelDate);
  assert(
    histStillDeferred.deferred >= 1,
    "hist entry without confirmEntryIds stays deferred",
  );
  assert(
    histStillDeferred.deferredEntryIds.includes(histEntry.id),
    "hist entry id listed in deferredEntryIds",
  );
  const histEntryStill = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: histEntry.id },
  });
  assert(
    histEntryStill.roomEffectsAppliedAt == null,
    "unconfirmed hist remains unstamped",
  );
  assert(
    histEntryStill.cleaningTaskId == null,
    "unconfirmed hist has no cleaningTaskId",
  );

  // Confirm with existing active task for past plan date → link, no second create
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      hotelDate: pastHotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework, TaskStatus.awaiting_inspection] },
    },
    data: { status: TaskStatus.cancelled },
  });
  const preexisting = await prisma.cleaningTask.create({
    data: {
      locationId: room.id,
      hotelDate: pastHotelDate,
      priority: Priority.normal,
      status: TaskStatus.assigned,
      cleaningCycle: confirmedRoom.cleaningCycle,
    },
  });
  const linkConfirm = await ensureDepartureRoomEffects(pastHotelDate, undefined, {
    confirmEntryIds: [histEntry.id],
  });
  assert(linkConfirm.applied === 1, `link-confirm applied=1, got ${linkConfirm.applied}`);
  const linkedEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: histEntry.id },
  });
  assert(
    linkedEntry.cleaningTaskId === preexisting.id,
    "confirm should link preexisting active task",
  );
  const linkedTask = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: preexisting.id },
  });
  assert(linkedTask.priority === Priority.high, "linked task bumped to high");
  const pastActiveCount = await prisma.cleaningTask.count({
    where: {
      locationId: room.id,
      hotelDate: pastHotelDate,
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework] },
    },
  });
  assert(pastActiveCount === 1, "linking must not create a second active task");

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

  // --- Import order independence: arrival↔departure both vacate + one departure task ---
  async function resetTodayForOrderTest(cycle: number) {
    await prisma.dailyPlanEntry.deleteMany({
      where: { hotelDate, locationId: roomRow.id },
    });
    await prisma.cleaningTask.updateMany({
      where: {
        locationId: roomRow.id,
        hotelDate,
        status: {
          in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework],
        },
      },
      data: { status: TaskStatus.cancelled },
    });
    await prisma.location.update({
      where: { id: roomRow.id },
      data: {
        cleaningCycle: cycle,
        cleaningStatus: CleaningStatus.verified_clean,
        occupancy: Occupancy.occupied,
      },
    });
  }

  async function assertTodayCheckoutApplied(label: string) {
    const after = await prisma.location.findUniqueOrThrow({
      where: { id: roomRow.id },
    });
    assert(
      after.occupancy === Occupancy.vacant,
      `${label}: expected vacant`,
    );
    assert(
      after.cleaningStatus === CleaningStatus.dirty,
      `${label}: expected dirty`,
    );
    const depEntry = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: {
        hotelDate_locationId_category: {
          hotelDate,
          locationId: roomRow.id,
          category: DailyPlanCategory.departure,
        },
      },
    });
    assert(
      depEntry.roomEffectsAppliedAt != null,
      `${label}: departure roomEffectsAppliedAt set`,
    );
    assert(
      depEntry.cleaningTaskId != null,
      `${label}: departure should bind a cleaning task`,
    );
    const activeTasks = await prisma.cleaningTask.findMany({
      where: {
        locationId: roomRow.id,
        hotelDate,
        status: {
          in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework],
        },
      },
    });
    assert(
      activeTasks.length === 1,
      `${label}: expected exactly 1 active task, got ${activeTasks.length}`,
    );
    assert(
      activeTasks[0].id === depEntry.cleaningTaskId,
      `${label}: active task must be the departure-bound task`,
    );
    assert(
      activeTasks[0].priority === Priority.high,
      `${label}: departure task should be high priority`,
    );
  }

  const orderCycleA = 100;
  await resetTodayForOrderTest(orderCycleA);
  const orderImportA = await importDailyPlan(
    {
      hotelDate: todayYmd,
      sourceLabel: "smoke-order-arrival-first",
      entries: [
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.arrival,
          externalId: `smoke-order-a-arr-${room.id}-${todayYmd}`,
        },
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.departure,
          externalId: `smoke-order-a-dep-${room.id}-${todayYmd}`,
        },
      ],
    },
    employeeId,
  );
  assert(
    orderImportA.batch.createdCount === 2,
    `arrival→departure createdCount=2, got ${orderImportA.batch.createdCount}`,
  );
  assert(
    orderImportA.batch.errorCount === 0,
    "arrival→departure import should have no errors",
  );
  await assertTodayCheckoutApplied("arrival→departure");

  const orderCycleB = 110;
  await resetTodayForOrderTest(orderCycleB);
  const orderImportB = await importDailyPlan(
    {
      hotelDate: todayYmd,
      sourceLabel: "smoke-order-departure-first",
      entries: [
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.departure,
          externalId: `smoke-order-b-dep-${room.id}-${todayYmd}`,
        },
        {
          buildingCode,
          roomNumber,
          category: DailyPlanCategory.arrival,
          externalId: `smoke-order-b-arr-${room.id}-${todayYmd}`,
        },
      ],
    },
    employeeId,
  );
  assert(
    orderImportB.batch.createdCount === 2,
    `departure→arrival createdCount=2, got ${orderImportB.batch.createdCount}`,
  );
  assert(
    orderImportB.batch.errorCount === 0,
    "departure→arrival import should have no errors",
  );
  await assertTodayCheckoutApplied("departure→arrival");

  // --- Future planned arrival (+7d) must not block today's departure ---
  const plus7Ymd = addDaysYmd(todayYmd, 7);
  const plus7HotelDate = new Date(`${plus7Ymd}T00:00:00.000Z`);
  await prisma.dailyPlanEntry.deleteMany({
    where: {
      locationId: room.id,
      OR: [{ hotelDate }, { hotelDate: plus7HotelDate }],
    },
  });
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      hotelDate,
      status: {
        in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework],
      },
    },
    data: { status: TaskStatus.cancelled },
  });
  const plus7Cycle = 120;
  await prisma.location.update({
    where: { id: room.id },
    data: {
      cleaningCycle: plus7Cycle,
      cleaningStatus: CleaningStatus.verified_clean,
      occupancy: Occupancy.occupied,
    },
  });
  await createDailyPlanEntry({
    hotelDate: plus7Ymd,
    locationId: room.id,
    category: DailyPlanCategory.arrival,
    notes: "arrival in 7 days",
    createdByEmployeeId: employeeId,
  });
  const plus7Dep = await createDailyPlanEntry({
    hotelDate: todayYmd,
    locationId: room.id,
    category: DailyPlanCategory.departure,
    notes: "today departure with +7 arrival",
    createdByEmployeeId: employeeId,
  });
  assert(
    plus7Dep.effects.occupancy === "vacant",
    `+7 arrival must not protect; expected vacant, got ${plus7Dep.effects.occupancy}`,
  );
  assert(plus7Dep.effects.dirty === true, "+7 arrival must not block dirty");
  assert(
    plus7Dep.effects.task === "created",
    `+7 arrival must not block task; got ${plus7Dep.effects.task}`,
  );
  const plus7Room = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(plus7Room.occupancy === Occupancy.vacant, "+7 arrival: room vacant");
  assert(
    plus7Room.cleaningStatus === CleaningStatus.dirty,
    "+7 arrival: room dirty",
  );

  // --- Historical import with proven newer stay (set_occupancy audit) → protect ---
  // Run last so the occupancy audit does not poison earlier defer scenarios.
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
      occupancy: Occupancy.vacant,
    },
  });
  await setLocationOccupancy(room.id, Occupancy.occupied, employeeId);

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
